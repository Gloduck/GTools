import {
    getMimeType,
    getParentFilePath,
    joinFilePath,
    normalizeFilePath,
} from '../file-utils.js';
import {FileSystem, MemoryProvider} from '../file-system/index.js';
import {
    detectJavaScriptSourceFormat,
    escapeModuleSpecifier,
    scanCommonJsModuleSpecifiers,
    scanEsmModuleSpecifiers,
} from './module-source-scanner.js';
import {createCryptoModule} from './node-crypto.js';
import {Buffer as BrowserBuffer, SlowBuffer, kMaxLength} from 'buffer';
import EventEmitter from 'events';
import pathBrowserify from 'path-browserify';
import punycode from 'punycode';
import Stream from 'stream-browserify';
import stringDecoder from 'string_decoder';
import utilBrowserify from 'util';
import {
    deflateSync as rawDeflateSync,
    gzipSync as fflateGzipSync,
    gunzipSync as fflateGunzipSync,
    inflateSync as rawInflateSync,
    unzlibSync,
    zlibSync,
} from 'fflate';

const BUILTIN_ALIASES = new Map([
    ['assert', 'node:assert'],
    ['assert/strict', 'node:assert/strict'],
    ['buffer', 'node:buffer'],
    ['cluster', 'node:cluster'],
    ['crypto', 'node:crypto'],
    ['events', 'node:events'],
    ['fs', 'node:fs'],
    ['fs/promises', 'node:fs/promises'],
    ['http', 'node:http'],
    ['https', 'node:https'],
    ['path', 'node:path'],
    ['path/posix', 'node:path/posix'],
    ['punycode', 'node:punycode'],
    ['querystring', 'node:querystring'],
    ['process', 'node:process'],
    ['stream', 'node:stream'],
    ['stream/promises', 'node:stream/promises'],
    ['stream/web', 'node:stream/web'],
    ['string_decoder', 'node:string_decoder'],
    ['timers', 'node:timers'],
    ['timers/promises', 'node:timers/promises'],
    ['tty', 'node:tty'],
    ['url', 'node:url'],
    ['util', 'node:util'],
    ['util/types', 'node:util/types'],
    ['zlib', 'node:zlib'],
]);

class NodeWorker {
    constructor(options = {}) {
        this.options = this.normalizeOptions(options);
        this.moduleFormats = new Map(this.options.files
            .filter((file) => file.format)
            .map((file) => [file.path, file.format]));
        this.fileSystem = this.createFileSystem(this.options);
        this.network = this.createNetwork(this.options);
        this.moduleCache = new Map();
        this.requireCache = createRequireCache(this.moduleCache);
        this.esmUrlCache = new Map();
        this.esmBuildStack = new Set();
        this.esmValues = new Map();
        this.esmModuleValues = new Map();
        this.esmModulePromises = new Map();
        this.scriptGlobalRestores = new Map();
        this.moduleUrls = [];
        this.runtimeKey = `__browserNodeWorker_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        this.usesDataModuleUrls = Boolean(globalThis.process?.versions?.node);
        this.Buffer = BrowserBuffer;
        this.process = this.createProcess(this.options);
        this.console = globalThis.console;
        this.builtins = this.createBuiltinModules(this.options);
    }

    normalizeOptions(options) {
        const entryPath = normalizeFilePath(options.entryPath || (isModuleFormat(options.format) ? 'index.mjs' : 'index.js'));
        const files = [];
        if (options.code !== undefined) {
            files.push({
                path: entryPath,
                content: String(options.code),
                mimeType: 'text/javascript',
                format: normalizeOptionalFileFormat(options.format),
            });
        }
        for (const file of options.files || []) {
            const path = normalizeFilePath(file.path);
            if (!path || files.some((candidate) => candidate.path === path)) continue;
            files.push({
                path,
                content: file.content ?? '',
                mimeType: file.mimeType || '',
                format: normalizeOptionalFileFormat(file.format),
            });
        }
        return {
            code: options.code,
            format: options.format,
            entryPath,
            cwd: options.cwd,
            input: options.input,
            env: options.env,
            args: options.args,
            files,
        };
    }

    // NodeWorker 固定使用隔离的内存 Provider，子类只调整 policy 和写入范围。
    createFileSystem(options) {
        return new FileSystem({
            provider: new MemoryProvider(this.createFileSystemConfig(options)),
            policy: this.createFileSystemPolicy(options),
        });
    }

    createFileSystemConfig(options) {
        return {writable: true, files: options.files};
    }

    createFileSystemPolicy() {
        return null;
    }

    createNetwork() {
        const fetch = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null;
        return {
            fetch,
            XMLHttpRequest: globalThis.XMLHttpRequest,
        };
    }

    createProcess(options) {
        const worker = this;
        return {
            argv: ['/usr/bin/node', displayPath(options.entryPath || 'index.cjs'), ...(options.args || []).map(String)],
            env: Object.freeze({...options.env}),
            exitCode: 0,
            cwd() {
                return displayPath(worker.getCwd());
            },
            exit(code = 0) {
                const normalizedCode = Number(code) || 0;
                this.exitCode = normalizedCode;
                throw new NodeProcessExit(normalizedCode);
            },
            nextTick(callback, ...args) {
                queueMicrotask(() => callback(...args));
            },
        };
    }

    createBuiltinModules() {
        const path = createPathModule(() => this.getCwd());
        const streamPromises = createStreamPromisesModule(Stream);
        const streamWeb = createStreamWebModule();
        const timers = createTimersModule();
        const builtins = new Map([
            ['node:assert', createAssertModule()],
            ['node:assert/strict', createAssertModule()],
            ['node:buffer', {
                Buffer: this.Buffer,
                SlowBuffer,
                kMaxLength,
            }],
            ['node:cluster', createClusterModule()],
            ['node:crypto', createCryptoModule(this.Buffer)],
            ['node:events', EventEmitter],
            ['node:path', path],
            ['node:path/posix', path],
            ['node:process', this.process],
            ['node:punycode', punycode],
            ['node:querystring', createQueryStringModule()],
            ['node:stream', Stream],
            ['node:stream/promises', streamPromises],
            ['node:stream/web', streamWeb],
            ['node:string_decoder', stringDecoder],
            ['node:timers', timers],
            ['node:timers/promises', createTimersPromisesModule(timers)],
            ['node:tty', createTtyModule()],
            ['node:url', createUrlModule()],
            ['node:util', utilBrowserify],
            ['node:util/types', utilBrowserify.types || {}],
            ['node:zlib', createZlibModule(this.Buffer, Stream)],
        ]);
        const fileModules = createNodeFsModules({
            fileSystem: this.fileSystem,
            Buffer: this.Buffer,
            getCwd: () => this.getCwd(),
        });
        builtins.set('node:fs', fileModules.fs);
        builtins.set('node:fs/promises', fileModules.promises);
        if (this.network.fetch) {
            builtins.set('node:http', createHttpModule(this.network.fetch, 'http:', this.Buffer));
            builtins.set('node:https', createHttpModule(this.network.fetch, 'https:', this.Buffer));
        }
        return builtins;
    }

    getCwd() {
        return normalizeFilePath(this.options.cwd || '');
    }

    getBuiltinModule(specifier) {
        const normalized = BUILTIN_ALIASES.get(specifier) || specifier;
        if (this.builtins.has(normalized)) return this.builtins.get(normalized);
        if (normalized.startsWith('node:')) {
            throw nodeWorkerError('UNSUPPORTED_NODE_BUILTIN', `Unsupported Node builtin: ${normalized}`, {specifier: normalized});
        }
        return undefined;
    }

    async run() {
        const entryPath = normalizeFilePath(this.options.entryPath || defaultEntryPath(this.options.format));
        this.process.argv[1] = displayPath(entryPath);
        const source = this.options.code === undefined
            ? this.readModuleText(entryPath)
            : stripShebang(String(this.options.code));
        await this.resolveModuleFormats(entryPath);
        const format = await this.getEntryFormat(entryPath, source);
        const previousGlobals = this.installRuntimeGlobals();

        try {
            if (format !== 'module') await this.prepareCommonJsDependencies(entryPath, source);
            const exports = format === 'module'
                ? await this.executeEsmEntry(entryPath, source)
                : await this.executeCommonJsEntry(entryPath, source, format);
            if (this.process.exitCode !== 0) {
                throw nodeWorkerError('PROCESS_EXIT', `Process exited with code ${this.process.exitCode}`, {
                    exitCode: this.process.exitCode,
                });
            }
            return {exports, exitCode: this.process.exitCode};
        } catch (error) {
            if (error instanceof NodeProcessExit) {
                if (error.exitCode === 0) return {exports: undefined, exitCode: 0};
                throw nodeWorkerError('PROCESS_EXIT', `Process exited with code ${error.exitCode}`, {
                    exitCode: error.exitCode,
                });
            }
            throw error;
        } finally {
            this.restoreScriptGlobals();
            restoreGlobals(previousGlobals);
            this.disposeModuleUrls();
        }
    }

    async getEntryFormat(path, source) {
        const requested = normalizeFormat(this.options.format);
        if (requested !== 'auto') return requested;
        const detectedFormat = this.moduleFormats.get(normalizeFilePath(path));
        if (isJavaScriptFormat(detectedFormat)) return detectedFormat;
        return detectJavaScriptSourceFormat(source);
    }

    async resolveModuleFormats(entryPath) {
        for (const file of this.options.files) {
            if (this.moduleFormats.has(file.path)) continue;
            const directFormat = this.getDirectModuleFormat(file.path);
            if (directFormat) {
                this.moduleFormats.set(file.path, directFormat);
            } else if (file.path === entryPath || isJavaScriptFile(file)) {
                this.moduleFormats.set(file.path, await detectJavaScriptSourceFormat(String(file.content ?? '')));
            }
        }
    }

    getModuleFormat(path) {
        const normalizedPath = normalizeFilePath(path);
        const declaredFormat = this.moduleFormats.get(normalizedPath);
        if (declaredFormat) return declaredFormat;
        return this.getDirectModuleFormat(normalizedPath)
            || (normalizedPath.endsWith('.js') ? 'commonjs' : '');
    }

    getDirectModuleFormat(path) {
        const normalizedPath = normalizeFilePath(path);
        if (normalizedPath.endsWith('.mjs')) return 'module';
        if (normalizedPath.endsWith('.cjs')) return 'commonjs';
        if (normalizedPath.endsWith('.json')) return 'json';
        if (!normalizedPath.endsWith('.js')) return '';
        return this.getPackageModuleFormat(normalizedPath);
    }

    getPackageModuleFormat(path) {
        let directory = getParentFilePath(path);
        while (true) {
            const packagePath = joinFilePath(directory, 'package.json');
            if (this.isFile(packagePath)) {
                try {
                    return JSON.parse(this.readModuleText(packagePath)).type === 'module' ? 'module' : 'commonjs';
                } catch {
                    return 'commonjs';
                }
            }
            if (!directory) break;
            directory = getParentFilePath(directory);
        }
        return '';
    }

    async executeCommonJsEntry(path, source, format = 'commonjs') {
        const module = {id: path, filename: displayPath(path), exports: {}, loaded: false};
        this.moduleCache.set(path, module);
        const completion = this.executeCommonJsSource(path, source, module, format === 'commonjs', format);
        module.loaded = true;
        if (isThenable(completion)) {
            const resolved = await completion;
            return resolved === undefined ? module.exports : resolved;
        }
        if (isThenable(module.exports)) {
            const resolved = await module.exports;
            return resolved === undefined ? module.exports : resolved;
        }
        return module.exports;
    }

    executeCommonJsSource(path, source, module, captureCompletion = false, format = 'commonjs') {
        const require = this.createRequire(path);
        const initialExports = module.exports;
        const globalSnapshot = isGlobalAwareFormat(format) ? captureGlobalDescriptors() : null;
        const parameters = [
            'require',
            'module',
            'exports',
            '__filename',
            '__dirname',
            'process',
            'Buffer',
            'console',
            'fetch',
            'XMLHttpRequest',
            'input',
        ];
        const values = [
            require,
            module,
            module.exports,
            displayPath(path),
            displayPath(getParentFilePath(path)),
            this.process,
            this.Buffer,
            this.console,
            this.network.fetch,
            this.network.XMLHttpRequest,
            this.options.input,
        ];
        const sourceUrl = `\n//# sourceURL=${displayPath(path)}`;
        let completion;
        try {
            if (captureCompletion) {
                const execute = new Function(...parameters, 'source', '"use strict"; return eval(source);');
                completion = execute(...values, `${stripShebang(source)}${sourceUrl}`);
            } else if (format === 'global') {
                completion = (0, eval)(`${stripShebang(source)}${sourceUrl}`);
            } else {
                const strict = format === 'commonjs' ? '"use strict";\n' : '';
                const execute = new Function(...parameters, `${strict}${stripShebang(source)}${sourceUrl}`);
                completion = execute.call(globalThis, ...values);
            }
        } catch (error) {
            if (globalSnapshot) this.collectGlobalModuleExports(globalSnapshot);
            throw error;
        }

        if (globalSnapshot) {
            const globalExports = this.collectGlobalModuleExports(globalSnapshot);
            if (format === 'global' || (format === 'umd' && !hasModuleExports(module, initialExports))) {
                if (globalExports.found) module.exports = globalExports.value;
            }
        }
        return completion;
    }

    async prepareCommonJsDependencies(path, source, visited = new Set()) {
        const normalizedPath = normalizeFilePath(path);
        const cacheKey = `commonjs:${normalizedPath}`;
        if (visited.has(cacheKey)) return;
        visited.add(cacheKey);

        for (const dependency of scanCommonJsModuleSpecifiers(source)) {
            if (dependency.kind !== 'require') continue;
            const specifier = dependency.specifier;
            const builtin = BUILTIN_ALIASES.get(specifier) || specifier;
            if (this.builtins.has(builtin) || builtin.startsWith('node:')) continue;

            let dependencyPath;
            try {
                dependencyPath = this.resolveModule(specifier, normalizedPath, 'require');
            } catch (error) {
                if (error?.code === 'MODULE_NOT_FOUND') continue;
                throw error;
            }
            const format = this.getModuleFormat(dependencyPath);
            if (format === 'module') {
                await this.prepareEsmDependencies(dependencyPath, this.readModuleText(dependencyPath), visited);
                await this.loadEsmModuleValue(dependencyPath);
            } else if (isCommonJsLikeFormat(format)) {
                await this.prepareCommonJsDependencies(dependencyPath, this.readModuleText(dependencyPath), visited);
            }
        }
    }

    async prepareEsmDependencies(path, source, visited = new Set()) {
        const normalizedPath = normalizeFilePath(path);
        const cacheKey = `module:${normalizedPath}`;
        if (visited.has(cacheKey)) return;
        visited.add(cacheKey);

        for (const dependency of await scanEsmModuleSpecifiers(source)) {
            if (!dependency.specifier) continue;
            const builtin = BUILTIN_ALIASES.get(dependency.specifier) || dependency.specifier;
            if (this.builtins.has(builtin) || builtin.startsWith('node:')) continue;

            const dependencyPath = this.resolveModule(dependency.specifier, normalizedPath, 'import');
            const format = this.getModuleFormat(dependencyPath);
            if (format === 'module') {
                await this.prepareEsmDependencies(dependencyPath, this.readModuleText(dependencyPath), visited);
            } else if (isCommonJsLikeFormat(format)) {
                await this.prepareCommonJsDependencies(dependencyPath, this.readModuleText(dependencyPath), visited);
            }
        }
    }

    async loadEsmModuleValue(path) {
        const normalizedPath = normalizeFilePath(path);
        if (this.esmModuleValues.has(normalizedPath)) return this.esmModuleValues.get(normalizedPath);
        if (!this.esmModulePromises.has(normalizedPath)) {
            this.esmModulePromises.set(normalizedPath, (async () => {
                const url = await this.buildEsmModuleUrl(normalizedPath);
                const value = await import(/* @vite-ignore */ url);
                this.esmModuleValues.set(normalizedPath, value);
                return value;
            })());
        }
        return this.esmModulePromises.get(normalizedPath);
    }

    createRequire(parentPath) {
        const require = (specifier) => {
            const builtin = this.getBuiltinModule(String(specifier));
            if (builtin !== undefined) return builtin;
            const path = this.resolveModule(String(specifier), parentPath, 'require');
            return this.loadCommonJsModule(path);
        };
        require.resolve = (specifier) => {
            const builtin = BUILTIN_ALIASES.get(String(specifier)) || String(specifier);
            if (this.builtins.has(builtin)) return builtin;
            return displayPath(this.resolveModule(String(specifier), parentPath, 'require'));
        };
        require.cache = this.requireCache;
        return require;
    }

    loadCommonJsModule(path) {
        const normalizedPath = normalizeFilePath(path);
        const cached = this.moduleCache.get(normalizedPath);
        if (cached) return cached.exports;

        const format = this.getModuleFormat(normalizedPath);
        if (format === 'module') {
            if (!this.esmModuleValues.has(normalizedPath)) {
                throw nodeWorkerError('ERR_REQUIRE_ESM', `require() cannot dynamically load an ES module: ${displayPath(normalizedPath)}`, {
                    path: displayPath(normalizedPath),
                });
            }
            const exports = esmNamespaceForRequire(this.esmModuleValues.get(normalizedPath));
            this.moduleCache.set(normalizedPath, {
                id: normalizedPath,
                filename: displayPath(normalizedPath),
                exports,
                loaded: true,
            });
            return exports;
        }
        if (format === 'json') {
            const module = {id: normalizedPath, filename: displayPath(normalizedPath), exports: {}, loaded: false};
            this.moduleCache.set(normalizedPath, module);
            module.exports = JSON.parse(this.readModuleText(normalizedPath));
            module.loaded = true;
            return module.exports;
        }

        const module = {id: normalizedPath, filename: displayPath(normalizedPath), exports: {}, loaded: false};
        this.moduleCache.set(normalizedPath, module);
        try {
            this.executeCommonJsSource(normalizedPath, this.readModuleText(normalizedPath), module, false, format);
            module.loaded = true;
            return module.exports;
        } catch (error) {
            this.moduleCache.delete(normalizedPath);
            throw error;
        }
    }

    async executeEsmEntry(path, source) {
        const url = await this.buildEsmModuleUrl(path, source);
        return import(/* @vite-ignore */ url);
    }

    async buildEsmModuleUrl(path, sourceOverride) {
        const normalizedPath = normalizeFilePath(path);
        if (this.esmUrlCache.has(normalizedPath)) return this.esmUrlCache.get(normalizedPath);
        if (this.esmBuildStack.has(normalizedPath)) {
            throw nodeWorkerError('UNSUPPORTED_ESM_CYCLE', `Circular ESM imports are not supported: ${displayPath(normalizedPath)}`, {
                path: displayPath(normalizedPath),
            });
        }

        this.esmBuildStack.add(normalizedPath);
        try {
            const source = sourceOverride === undefined ? this.readModuleText(normalizedPath) : stripShebang(sourceOverride);
            const replacements = [];
            for (const dependency of await scanEsmModuleSpecifiers(source)) {
                if (!dependency.specifier) {
                    throw nodeWorkerError('DYNAMIC_MODULE_NOT_PRELOADED', `Dynamic import must use a string literal: ${displayPath(normalizedPath)}`, {
                        path: displayPath(normalizedPath),
                    });
                }
                replacements.push({
                    start: dependency.start,
                    end: dependency.end,
                    value: await this.resolveEsmUrl(dependency.specifier, normalizedPath),
                    quote: dependency.quote,
                });
            }
            const transformed = applyReplacements(source, replacements);
            const url = this.createModuleUrl(`${transformed}\n//# sourceURL=${displayPath(normalizedPath)}`);
            this.esmUrlCache.set(normalizedPath, url);
            return url;
        } finally {
            this.esmBuildStack.delete(normalizedPath);
        }
    }

    async resolveEsmUrl(specifier, parentPath) {
        const builtin = this.getBuiltinModule(specifier);
        if (builtin !== undefined) return this.createValueModuleUrl(`builtin:${specifier}`, builtin);

        const path = this.resolveModule(specifier, parentPath, 'import');
        const format = this.getModuleFormat(path);
        if (format === 'module') return this.buildEsmModuleUrl(path);
        if (format === 'json') return this.createValueModuleUrl(path, JSON.parse(this.readModuleText(path)));
        return this.createValueModuleUrl(path, this.loadCommonJsModule(path));
    }

    createValueModuleUrl(key, value) {
        const cacheKey = `value:${key}`;
        if (this.esmUrlCache.has(cacheKey)) return this.esmUrlCache.get(cacheKey);
        const id = `value-${this.esmValues.size}`;
        this.esmValues.set(id, value);
        const names = value && (typeof value === 'object' || typeof value === 'function')
            ? Object.keys(value).filter(isValidIdentifier)
            : [];
        const exports = names.map((name) => `export const ${name} = value[${JSON.stringify(name)}];`).join('\n');
        const source = [
            `const value = globalThis[${JSON.stringify(this.runtimeKey)}].values.get(${JSON.stringify(id)});`,
            'export default value;',
            exports,
        ].join('\n');
        const url = this.createModuleUrl(source);
        this.esmUrlCache.set(cacheKey, url);
        return url;
    }

    createModuleUrl(source) {
        if (this.usesDataModuleUrls) return `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`;
        const url = URL.createObjectURL(new Blob([source], {type: 'text/javascript'}));
        this.moduleUrls.push(url);
        return url;
    }

    disposeModuleUrls() {
        for (const url of this.moduleUrls) URL.revokeObjectURL(url);
        this.moduleUrls.length = 0;
    }

    installRuntimeGlobals() {
        const values = {
            [this.runtimeKey]: {values: this.esmValues},
            global: globalThis,
            process: this.process,
            Buffer: this.Buffer,
            console: this.console,
            fetch: this.network.fetch,
            XMLHttpRequest: this.network.XMLHttpRequest,
            input: this.options.input,
        };
        const previous = [];
        for (const [name, value] of Object.entries(values)) {
            previous.push([name, Object.getOwnPropertyDescriptor(globalThis, name)]);
            Object.defineProperty(globalThis, name, {configurable: true, writable: true, value});
        }
        return previous;
    }

    collectGlobalModuleExports(before) {
        const after = captureGlobalDescriptors();
        const changed = [];
        const names = new Set([...before.keys(), ...after.keys()]);
        for (const name of names) {
            const previous = before.get(name);
            const current = after.get(name);
            if (samePropertyDescriptor(previous, current)) continue;
            if (!this.scriptGlobalRestores.has(name)) this.scriptGlobalRestores.set(name, previous);
            if (current) changed.push([name, readGlobalProperty(name, current)]);
        }
        if (changed.length === 1) return {found: true, value: changed[0][1]};
        if (changed.length > 1) return {found: true, value: Object.fromEntries(changed)};
        return {found: false, value: undefined};
    }

    restoreScriptGlobals() {
        for (const [name, descriptor] of [...this.scriptGlobalRestores.entries()].reverse()) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else delete globalThis[name];
        }
        this.scriptGlobalRestores.clear();
    }

    resolveModule(specifier, parentPath, mode, mappedSpecifiers = new Set()) {
        const mappingKey = `${parentPath}\0${specifier}\0${mode}`;
        if (!mappedSpecifiers.has(mappingKey)) {
            mappedSpecifiers.add(mappingKey);
            const packageTarget = specifier.startsWith('#')
                ? this.resolvePackageImportTarget(specifier, parentPath, mode)
                : this.resolveBrowserTarget(specifier, parentPath);
            if (packageTarget) {
                return this.resolveModule(packageTarget.specifier, packageTarget.parentPath, mode, mappedSpecifiers);
            }
        }
        const candidates = [];
        if (specifier.startsWith('/') || specifier.startsWith('./') || specifier.startsWith('../')) {
            const base = specifier.startsWith('/') ? '' : getParentFilePath(parentPath);
            candidates.push({path: resolveLogicalPath(specifier, base), subpath: ''});
        } else {
            const packageSpecifier = splitPackageSpecifier(specifier);
            let directory = getParentFilePath(parentPath);
            while (true) {
                candidates.push({
                    path: joinFilePath(directory, 'node_modules', packageSpecifier.name),
                    subpath: packageSpecifier.subpath,
                });
                if (!directory) break;
                directory = getParentFilePath(directory);
            }
        }

        for (const candidate of candidates) {
            const visited = new Set();
            const resolved = candidate.subpath
                ? this.resolvePackageSubpath(candidate.path, candidate.subpath, mode, visited)
                : this.resolveModuleCandidate(candidate.path, mode, visited);
            if (resolved) return resolved;
        }
        throw nodeWorkerError('MODULE_NOT_FOUND', `Cannot find module '${specifier}' from ${displayPath(parentPath)}`, {
            specifier,
            parent: displayPath(parentPath),
        });
    }

    resolvePackageImportTarget(specifier, parentPath, mode) {
        const scope = this.findPackageScope(parentPath);
        if (!scope) return null;
        const target = packageImport(scope.manifest, specifier, mode);
        if (!target) return null;
        return {
            specifier: target,
            parentPath: target.startsWith('.') ? scope.packagePath : parentPath,
        };
    }

    resolveBrowserTarget(specifier, parentPath) {
        const scope = this.findPackageScope(parentPath);
        const browser = scope?.manifest?.browser;
        if (!browser || typeof browser !== 'object' || Array.isArray(browser)) return null;
        const candidates = [specifier];
        if (specifier.startsWith('./') || specifier.startsWith('../')) {
            const resolved = resolveLogicalPath(specifier, getParentFilePath(parentPath));
            const relative = relativeModulePath(resolved, scope.root);
            if (relative !== null) candidates.unshift(`./${relative}`);
        }
        const key = candidates.find((candidate) => Object.prototype.hasOwnProperty.call(browser, candidate));
        if (!key || typeof browser[key] !== 'string') return null;
        return {
            specifier: browser[key],
            parentPath: browser[key].startsWith('.') ? scope.packagePath : parentPath,
        };
    }

    findPackageScope(path) {
        let directory = getParentFilePath(path);
        while (true) {
            const packagePath = joinFilePath(directory, 'package.json');
            if (this.isFile(packagePath)) {
                try {
                    return {root: directory, packagePath, manifest: JSON.parse(this.readModuleText(packagePath))};
                } catch {
                    return null;
                }
            }
            if (!directory) return null;
            directory = getParentFilePath(directory);
        }
    }

    resolveModuleCandidate(path, mode, visited) {
        const normalizedPath = normalizeFilePath(path);
        if (visited.has(normalizedPath)) return null;
        visited.add(normalizedPath);

        if (this.isFile(normalizedPath)) return normalizedPath;
        for (const extension of mode === 'import' ? ['.mjs', '.js', '.cjs', '.json'] : ['.js', '.cjs', '.json', '.mjs']) {
            if (this.isFile(`${normalizedPath}${extension}`)) return `${normalizedPath}${extension}`;
        }
        if (!this.isDirectory(normalizedPath)) return null;

        const packagePath = joinFilePath(normalizedPath, 'package.json');
        if (this.isFile(packagePath)) {
            try {
                const manifest = JSON.parse(this.readModuleText(packagePath));
                const target = packageEntry(manifest, mode);
                if (target) {
                    const resolved = this.resolveModuleCandidate(joinFilePath(normalizedPath, target), mode, visited);
                    if (resolved) return resolved;
                }
            } catch (error) {
                if (error?.code) throw error;
            }
        }
        for (const name of mode === 'import'
            ? ['index.mjs', 'index.js', 'index.cjs', 'index.json']
            : ['index.js', 'index.cjs', 'index.json', 'index.mjs']) {
            const candidate = joinFilePath(normalizedPath, name);
            if (this.isFile(candidate)) return candidate;
        }
        return null;
    }

    resolvePackageSubpath(root, subpath, mode, visited) {
        const normalizedRoot = normalizeFilePath(root);
        if (!this.isDirectory(normalizedRoot)) return null;
        const packagePath = joinFilePath(normalizedRoot, 'package.json');
        if (this.isFile(packagePath)) {
            try {
                const manifest = JSON.parse(this.readModuleText(packagePath));
                const target = packageExport(manifest, `./${subpath}`, mode);
                if (target) {
                    const resolved = this.resolveModuleCandidate(joinFilePath(normalizedRoot, target), mode, visited);
                    if (resolved) return resolved;
                }
            } catch (error) {
                if (error?.code) throw error;
            }
        }
        return this.resolveModuleCandidate(joinFilePath(normalizedRoot, subpath), mode, visited);
    }

    isFile(path) {
        try {
            return this.fileSystem?.statSync(path).kind === 'file';
        } catch (error) {
            if (error?.code === 'FILE_NOT_FOUND') return false;
            throw error;
        }
    }

    isDirectory(path) {
        try {
            return this.fileSystem?.statSync(path).kind === 'directory';
        } catch (error) {
            if (error?.code === 'FILE_NOT_FOUND') return false;
            throw error;
        }
    }

    readModuleText(path) {
        return this.fileSystem.readTextSync(path);
    }
}

function createNodeFsModules({fileSystem, Buffer, getCwd}) {
    const promises = createNodeFsPromisesModule(fileSystem, Buffer, getCwd);
    return {
        fs: createNodeFsModule(fileSystem, Buffer, promises, getCwd),
        promises,
    };
}

function createNodeFsModule(fileSystem, Buffer, promises, getCwd) {
    const fs = {
        promises,
        readFileSync(path, options) {
            const normalized = resolveNodeFsPath(path, getCwd());
            const encoding = getNodeFsEncoding(options);
            const bytes = fileSystem.readBytesSync(normalized);
            return encoding ? new TextDecoder(encoding).decode(bytes) : Buffer.from(bytes);
        },
        writeFileSync(path, value, options) {
            const normalized = resolveNodeFsPath(path, getCwd());
            fileSystem.writeBytesSync(normalized, toNodeFsBytes(value, getNodeFsEncoding(options)), {
                createParents: true,
                mimeType: typeof options === 'object' && options.mimeType ? options.mimeType : getMimeType(normalized),
            });
        },
        statSync(path) {
            return createNodeFsStats(fileSystem.statSync(resolveNodeFsPath(path, getCwd())));
        },
        existsSync(path) {
            try {
                fileSystem.statSync(resolveNodeFsPath(path, getCwd()));
                return true;
            } catch (error) {
                if (error?.code === 'FILE_NOT_FOUND') return false;
                throw error;
            }
        },
        readdirSync(path = '.', options) {
            return formatNodeFsDirectoryEntries(fileSystem.listSync(resolveNodeFsPath(path, getCwd())), options);
        },
        mkdirSync(path, options = {}) {
            resolveNodeFsPath(path, getCwd());
            if (options?.recursive === false) throw nodeFsError('UNSUPPORTED_FILE_OPERATION', 'mkdirSync requires recursive: true');
        },
        readFile(path, options, callback) {
            if (typeof options === 'function') {
                callback = options;
                options = undefined;
            }
            runNodeCallback(callback, () => fs.readFileSync(path, options));
        },
        writeFile(path, value, options, callback) {
            if (typeof options === 'function') {
                callback = options;
                options = undefined;
            }
            runNodeCallback(callback, () => fs.writeFileSync(path, value, options));
        },
        createWriteStream(path, options = {}) {
            const listeners = new Map();
            const chunks = [];
            let ended = false;
            const stream = {
                on(name, listener) {
                    if (!listeners.has(name)) listeners.set(name, []);
                    listeners.get(name).push(listener);
                    return this;
                },
                once(name, listener) {
                    const wrapped = (...args) => {
                        removeListener(name, wrapped);
                        listener(...args);
                    };
                    return this.on(name, wrapped);
                },
                write(chunk, encoding) {
                    if (ended) throw nodeFsError('ERR_STREAM_WRITE_AFTER_END', 'write after end', {path: String(path)});
                    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, encoding) : Buffer.from(chunk));
                    return true;
                },
                end(chunk, encoding) {
                    if (chunk !== undefined) this.write(chunk, encoding);
                    if (ended) return this;
                    ended = true;
                    queueMicrotask(() => {
                        try {
                            fs.writeFileSync(path, Buffer.concat(chunks), options);
                            emit('finish');
                            emit('close');
                        } catch (error) {
                            emit('error', error);
                        }
                    });
                    return this;
                },
            };
            const removeListener = (name, listener) => {
                const values = listeners.get(name);
                if (!values) return;
                const index = values.indexOf(listener);
                if (index !== -1) values.splice(index, 1);
            };
            const emit = (name, ...args) => {
                for (const listener of [...(listeners.get(name) || [])]) listener(...args);
            };
            queueMicrotask(() => emit('open', displayPath(resolveNodeFsPath(path, getCwd()))));
            return stream;
        },
    };
    return fs;
}

function runNodeCallback(callback, operation) {
    if (typeof callback !== 'function') throw new TypeError('Callback must be a function');
    queueMicrotask(() => {
        try {
            callback(null, operation());
        } catch (error) {
            callback(error);
        }
    });
}

function createNodeFsPromisesModule(fileSystem, Buffer, getCwd) {
    return {
        async access(path) {
            await fileSystem.stat(resolveNodeFsPath(path, getCwd()));
        },
        async readFile(path, options) {
            const normalized = resolveNodeFsPath(path, getCwd());
            const encoding = getNodeFsEncoding(options);
            const blob = await fileSystem.readBlob(normalized);
            return encoding ? new TextDecoder(encoding).decode(await blob.arrayBuffer()) : Buffer.from(await blob.arrayBuffer());
        },
        async writeFile(path, value, options) {
            const normalized = resolveNodeFsPath(path, getCwd());
            return fileSystem.writeBlob(normalized, toNodeFsBytes(value, getNodeFsEncoding(options)), {
                createParents: true,
                mimeType: typeof options === 'object' && options.mimeType ? options.mimeType : getMimeType(normalized),
            });
        },
        async stat(path) {
            return createNodeFsStats(await fileSystem.stat(resolveNodeFsPath(path, getCwd())));
        },
        async readdir(path = '.', options) {
            return formatNodeFsDirectoryEntries(await fileSystem.list(resolveNodeFsPath(path, getCwd())), options);
        },
        async mkdir(path, options = {}) {
            return fileSystem.createDirectory(resolveNodeFsPath(path, getCwd()), {recursive: options?.recursive === true});
        },
        async unlink(path) {
            return fileSystem.unlink(resolveNodeFsPath(path, getCwd()));
        },
        async rm(path, options = {}) {
            return fileSystem.remove(resolveNodeFsPath(path, getCwd()), {
                recursive: options?.recursive === true,
                force: options?.force === true,
            });
        },
    };
}

function createNodeFsStats(entry) {
    return Object.freeze({
        size: entry.size,
        isFile: () => entry.kind === 'file',
        isDirectory: () => entry.kind === 'directory',
    });
}

function formatNodeFsDirectoryEntries(entries, options) {
    if (options?.withFileTypes !== true) return entries.map((entry) => entry.name);
    return entries.map((entry) => Object.freeze({
        name: entry.name,
        isFile: () => entry.kind === 'file',
        isDirectory: () => entry.kind === 'directory',
    }));
}

function resolveNodeFsPath(path, cwd) {
    if (path instanceof URL) {
        if (path.protocol !== 'file:') throw new TypeError('File URL must use file: protocol');
        path = decodeURIComponent(path.pathname);
    }
    const value = String(path || '');
    if (value.includes('\0')) throw nodeFsError('INVALID_FILE_PATH', `Invalid file path: ${value}`, {path: value});
    if (value.startsWith('/')) return normalizeNodeFsPath(value);
    return normalizeNodeFsPath(`${cwd}/${value}`);
}

function normalizeNodeFsPath(path) {
    const values = [];
    for (const part of String(path || '').replace(/\\/g, '/').split('/')) {
        if (!part || part === '.') continue;
        if (part === '..') {
            if (!values.length) throw nodeFsError('INVALID_FILE_PATH', `File path escapes the root: ${path}`, {path});
            values.pop();
        } else {
            values.push(part);
        }
    }
    return values.join('/');
}

function getNodeFsEncoding(options) {
    if (typeof options === 'string') return normalizeNodeFsEncoding(options);
    return options?.encoding ? normalizeNodeFsEncoding(options.encoding) : '';
}

function normalizeNodeFsEncoding(value) {
    const encoding = String(value || '').toLowerCase();
    if (encoding === 'utf8' || encoding === 'utf-8') return 'utf-8';
    throw nodeFsError('UNSUPPORTED_ENCODING', `Unsupported encoding: ${value}`, {encoding: value});
}

function toNodeFsBytes(value, encoding) {
    if (typeof value === 'string') return new TextEncoder(encoding || 'utf-8').encode(value);
    if (value instanceof Uint8Array) return new Uint8Array(value);
    if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    throw new TypeError('File data must be a string, ArrayBuffer, or typed array');
}

function nodeFsError(code, message, details = {}) {
    const error = new Error(message);
    error.code = code;
    Object.assign(error, details);
    return error;
}

class NodeProcessExit extends Error {
    constructor(exitCode) {
        super(`Process exited with code ${exitCode}`);
        this.name = 'NodeProcessExit';
        this.exitCode = exitCode;
    }
}

function defaultEntryPath(format) {
    return normalizeFormat(format) === 'module' ? 'index.mjs' : 'index.cjs';
}

function isModuleFormat(format) {
    return ['esm', 'mjs', 'module'].includes(String(format || '').trim().toLowerCase());
}

function normalizeFormat(format) {
    const value = String(format || 'auto').trim().toLowerCase();
    if (value === 'esm' || value === 'mjs' || value === 'module') return 'module';
    if (value === 'cjs' || value === 'commonjs') return 'commonjs';
    if (value === 'umd') return 'umd';
    if (value === 'global' || value === 'iife' || value === 'script') return 'global';
    if (value === 'auto') return 'auto';
    throw nodeWorkerError('INVALID_MODULE_FORMAT', `Unsupported module format: ${format}`, {format});
}

function normalizeOptionalFileFormat(format) {
    if (format === undefined || format === null || format === '') return '';
    const value = String(format).trim().toLowerCase();
    if (value === 'json') return 'json';
    const normalized = normalizeFormat(value);
    return normalized === 'auto' ? '' : normalized;
}

function isJavaScriptFormat(format) {
    return format === 'module' || isCommonJsLikeFormat(format);
}

function isCommonJsLikeFormat(format) {
    return format === 'commonjs' || format === 'umd' || format === 'global';
}

function isGlobalAwareFormat(format) {
    return format === 'umd' || format === 'global';
}

function isJavaScriptFile(file) {
    return /\.(?:cjs|js|mjs)$/i.test(file.path)
        || /(?:java|ecma)script/i.test(String(file.mimeType || ''));
}

function packageEntry(manifest, mode) {
    const target = packageExport(manifest, '.', mode);
    if (target) return target;
    if (typeof manifest?.browser === 'string') return manifest.browser;
    if (mode === 'import' && typeof manifest?.module === 'string') return manifest.module;
    return typeof manifest?.main === 'string' ? manifest.main : '';
}

function packageExport(manifest, subpath, mode) {
    const exports = manifest?.exports;
    if (!exports) return '';
    const target = exports && typeof exports === 'object' && !Array.isArray(exports)
        && Object.keys(exports).some((key) => key.startsWith('.'))
        ? exports[subpath]
        : subpath === '.' ? exports : undefined;
    return conditionalPackageExport(target, mode);
}

function conditionalPackageExport(target, mode) {
    if (typeof target === 'string') return target;
    if (Array.isArray(target)) {
        for (const value of target) {
            const resolved = conditionalPackageExport(value, mode);
            if (resolved) return resolved;
        }
        return '';
    }
    if (!target || typeof target !== 'object') return '';
    const conditions = mode === 'import'
        ? ['browser', 'import', 'default', 'require']
        : ['browser', 'require', 'default', 'import'];
    for (const condition of conditions) {
        const resolved = conditionalPackageExport(target[condition], mode);
        if (resolved) return resolved;
    }
    return '';
}

function packageImport(manifest, specifier, mode) {
    const imports = manifest?.imports;
    if (!imports || typeof imports !== 'object' || Array.isArray(imports)) return '';
    if (Object.prototype.hasOwnProperty.call(imports, specifier)) {
        return conditionalPackageExport(imports[specifier], mode);
    }
    for (const [pattern, target] of Object.entries(imports)) {
        const star = pattern.indexOf('*');
        if (star === -1 || !specifier.startsWith(pattern.slice(0, star)) || !specifier.endsWith(pattern.slice(star + 1))) continue;
        const match = specifier.slice(star, specifier.length - (pattern.length - star - 1));
        return conditionalPackageExport(target, mode).replaceAll('*', match);
    }
    return '';
}

function relativeModulePath(path, root) {
    const normalizedPath = normalizeFilePath(path);
    const normalizedRoot = normalizeFilePath(root);
    if (normalizedPath === normalizedRoot) return '';
    if (!normalizedRoot || !normalizedPath.startsWith(`${normalizedRoot}/`)) return null;
    return normalizedPath.slice(normalizedRoot.length + 1);
}

function splitPackageSpecifier(specifier) {
    const value = String(specifier || '');
    if (value.startsWith('@')) {
        const scopeEnd = value.indexOf('/');
        const subpathStart = scopeEnd === -1 ? -1 : value.indexOf('/', scopeEnd + 1);
        return {
            name: subpathStart === -1 ? value : value.slice(0, subpathStart),
            subpath: subpathStart === -1 ? '' : value.slice(subpathStart + 1),
        };
    }
    const subpathStart = value.indexOf('/');
    return {
        name: subpathStart === -1 ? value : value.slice(0, subpathStart),
        subpath: subpathStart === -1 ? '' : value.slice(subpathStart + 1),
    };
}

function applyReplacements(source, replacements) {
    let result = source;
    for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
        const value = escapeModuleSpecifier(replacement.value, replacement.quote);
        result = `${result.slice(0, replacement.start)}${value}${result.slice(replacement.end)}`;
    }
    return result;
}

function restoreGlobals(previous) {
    for (const [name, descriptor] of previous.reverse()) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
    }
}

function captureGlobalDescriptors() {
    return new Map(Object.entries(Object.getOwnPropertyDescriptors(globalThis)));
}

function samePropertyDescriptor(left, right) {
    if (left === right) return true;
    if (!left || !right) return false;
    return left.configurable === right.configurable
        && left.enumerable === right.enumerable
        && left.writable === right.writable
        && Object.is(left.value, right.value)
        && left.get === right.get
        && left.set === right.set;
}

function readGlobalProperty(name, descriptor) {
    if (Object.prototype.hasOwnProperty.call(descriptor, 'value')) return descriptor.value;
    try {
        return globalThis[name];
    } catch {
        return undefined;
    }
}

function hasModuleExports(module, initialExports) {
    if (module.exports !== initialExports) return true;
    return initialExports != null
        && (typeof initialExports === 'object' || typeof initialExports === 'function')
        && Object.keys(initialExports).length > 0;
}

function esmNamespaceForRequire(namespace) {
    const keys = namespace && typeof namespace === 'object' ? Object.keys(namespace) : [];
    return keys.length === 1 && keys[0] === 'default' ? namespace.default : namespace;
}

function createRequireCache(moduleCache) {
    const toKey = (value) => normalizeFilePath(String(value || ''));
    return new Proxy(Object.create(null), {
        ownKeys() {
            return [...moduleCache.keys()].map(displayPath);
        },
        getOwnPropertyDescriptor(target, property) {
            if (typeof property !== 'string') return undefined;
            const key = toKey(property);
            return moduleCache.has(key)
                ? {configurable: true, enumerable: true, writable: true, value: moduleCache.get(key)}
                : undefined;
        },
        get(target, property) {
            if (typeof property !== 'string') return Reflect.get(target, property);
            return moduleCache.get(toKey(property));
        },
        set(target, property, value) {
            if (typeof property !== 'string') return Reflect.set(target, property, value);
            moduleCache.set(toKey(property), value);
            return true;
        },
        deleteProperty(target, property) {
            return typeof property === 'string' ? moduleCache.delete(toKey(property)) : true;
        },
        has(target, property) {
            return typeof property === 'string' ? moduleCache.has(toKey(property)) : Reflect.has(target, property);
        },
    });
}

function resolveLogicalPath(path, base = '') {
    const value = String(path || '');
    return value.startsWith('/') ? normalizeFilePath(value) : joinFilePath(base, value);
}

function displayPath(path) {
    const normalized = normalizeFilePath(path);
    return normalized ? `/${normalized}` : '/';
}

function stripShebang(source) {
    return String(source || '').replace(/^#![^\n]*(?:\n|$)/, '');
}

function isThenable(value) {
    return value != null && typeof value.then === 'function';
}

function isValidIdentifier(value) {
    return /^[A-Za-z_$][\w$]*$/.test(value) && value !== 'default';
}

function nodeWorkerError(code, message, details = {}) {
    const error = new Error(message);
    error.code = code;
    Object.assign(error, details);
    return error;
}

function createPathModule(getCwd) {
    const api = {...pathBrowserify};
    api.resolve = (...paths) => pathBrowserify.resolve(displayPath(getCwd()), ...paths);
    api.posix = api;
    return api;
}

function createTtyModule() {
    return {isatty: () => false};
}

function createClusterModule() {
    const cluster = new EventEmitter();
    Object.assign(cluster, {
        SCHED_NONE: 1,
        SCHED_RR: 2,
        schedulingPolicy: 2,
        isPrimary: true,
        isMaster: true,
        isWorker: false,
        worker: undefined,
        workers: {},
        settings: {},
        setupPrimary(settings = {}) {
            cluster.settings = {...cluster.settings, ...settings};
            cluster.emit('setup', cluster.settings);
        },
        setupMaster(settings = {}) {
            cluster.setupPrimary(settings);
        },
        disconnect(callback) {
            queueMicrotask(() => {
                cluster.emit('disconnect');
                if (typeof callback === 'function') callback();
            });
        },
        fork() {
            throw nodeWorkerError('ERR_CLUSTER_UNSUPPORTED', 'Cluster worker processes are not supported in the browser runtime');
        },
    });
    return cluster;
}

function createStreamPromisesModule(Stream) {
    return {
        finished(stream, options) {
            return new Promise((resolve, reject) => Stream.finished(stream, options || {}, (error) => error ? reject(error) : resolve()));
        },
        pipeline(...streams) {
            return new Promise((resolve, reject) => Stream.pipeline(...streams, (error) => error ? reject(error) : resolve()));
        },
    };
}

function createStreamWebModule() {
    return {
        ReadableStream: globalThis.ReadableStream,
        WritableStream: globalThis.WritableStream,
        TransformStream: globalThis.TransformStream,
        ByteLengthQueuingStrategy: globalThis.ByteLengthQueuingStrategy,
        CountQueuingStrategy: globalThis.CountQueuingStrategy,
        TextEncoderStream: globalThis.TextEncoderStream,
        TextDecoderStream: globalThis.TextDecoderStream,
    };
}

function createZlibModule(Buffer, Stream) {
    const constants = {
        Z_NO_FLUSH: 0,
        Z_SYNC_FLUSH: 2,
        Z_FINISH: 4,
        Z_MIN_CHUNK: 64,
        Z_DEFAULT_COMPRESSION: -1,
        Z_DEFAULT_STRATEGY: 0,
    };
    const sync = (operation) => (value, options = {}) => Buffer.from(operation(Buffer.from(value), normalizeCompressionOptions(options)));
    const methods = {
        deflateSync: sync(zlibSync),
        inflateSync: sync(unzlibSync),
        deflateRawSync: sync(rawDeflateSync),
        inflateRawSync: sync(rawInflateSync),
        gzipSync: sync(fflateGzipSync),
        gunzipSync: sync(fflateGunzipSync),
    };
    methods.unzipSync = (value, options = {}) => {
        const bytes = Buffer.from(value);
        return bytes[0] === 0x1f && bytes[1] === 0x8b
            ? methods.gunzipSync(bytes, options)
            : methods.inflateSync(bytes, options);
    };

    const createCodec = (operation) => function Codec(options = {}) {
        if (!(this instanceof Codec)) return new Codec(options);
        const chunks = [];
        Stream.Transform.call(this, {
            transform(chunk, encoding, callback) {
                chunks.push(Buffer.from(chunk));
                callback();
            },
            flush(callback) {
                try {
                    callback(null, operation(Buffer.concat(chunks), options));
                } catch (error) {
                    callback(error);
                }
            },
        });
        this._processChunk = (chunk, flushFlag, callback) => {
            try {
                const result = operation(chunk, options);
                if (typeof callback === 'function') queueMicrotask(() => callback(null, result));
                else return result;
            } catch (error) {
                if (typeof callback === 'function') queueMicrotask(() => callback(error));
                else throw error;
            }
        };
    };
    const Deflate = createCodec(methods.deflateSync);
    const Inflate = createCodec(methods.inflateSync);
    const DeflateRaw = createCodec(methods.deflateRawSync);
    const InflateRaw = createCodec(methods.inflateRawSync);
    const Gzip = createCodec(methods.gzipSync);
    const Gunzip = createCodec(methods.gunzipSync);
    for (const Codec of [Deflate, Inflate, DeflateRaw, InflateRaw, Gzip, Gunzip]) inheritPrototype(Codec, Stream.Transform);

    const result = {
        ...constants,
        constants,
        ...methods,
        Deflate,
        Inflate,
        DeflateRaw,
        InflateRaw,
        Gzip,
        Gunzip,
        createDeflate: (options) => new Deflate(options),
        createInflate: (options) => new Inflate(options),
        createDeflateRaw: (options) => new DeflateRaw(options),
        createInflateRaw: (options) => new InflateRaw(options),
        createGzip: (options) => new Gzip(options),
        createGunzip: (options) => new Gunzip(options),
    };
    for (const name of ['deflate', 'inflate', 'deflateRaw', 'inflateRaw', 'gzip', 'gunzip', 'unzip']) {
        result[name] = (value, options, callback) => {
            if (typeof options === 'function') {
                callback = options;
                options = undefined;
            }
            runNodeCallback(callback, () => result[`${name}Sync`](value, options));
        };
    }
    return result;
}

function normalizeCompressionOptions(options) {
    const level = Number(options?.level);
    return Number.isFinite(level) && level >= 0 ? {level: Math.min(9, level)} : {};
}

function inheritPrototype(constructor, superConstructor) {
    constructor.super_ = superConstructor;
    constructor.prototype = Object.create(superConstructor.prototype, {
        constructor: {configurable: true, value: constructor, writable: true},
    });
}

function createHttpModule(fetch, protocol, Buffer) {
    const request = (input, options, callback) => {
        let requestOptions = options || {};
        if (typeof options === 'function') {
            callback = options;
            requestOptions = {};
        }
        if (input && typeof input === 'object' && !(input instanceof URL)) {
            requestOptions = {...input, ...requestOptions};
        }
        const target = createHttpTarget(protocol, input, requestOptions);
        const listeners = new Map();
        const chunks = [];
        let ended = false;
        const clientRequest = {
            write(chunk) {
                if (ended) throw new Error('write after end');
                chunks.push(Buffer.from(chunk));
                return true;
            },
            end(chunk) {
                if (chunk !== undefined) this.write(chunk);
                if (ended) return this;
                ended = true;
                void sendHttpRequest(fetch, target, requestOptions, chunks, callback, listeners, Buffer);
                return this;
            },
            on(name, listener) {
                listeners.set(name, listener);
                return this;
            },
            once(name, listener) {
                return this.on(name, listener);
            },
            setHeader() {
                return this;
            },
            abort() {
                return this;
            },
        };
        return clientRequest;
    };
    const result = {
        request,
        get(input, options, callback) {
            const result = request(input, options, callback);
            result.end();
            return result;
        },
    };
    if (protocol === 'http:') Object.assign(result, {
        METHODS: [...HTTP_METHODS],
        STATUS_CODES: {...HTTP_STATUS_CODES},
        validateHeaderName,
        validateHeaderValue,
    });
    return result;
}

function createHttpTarget(protocol, input, options) {
    if (typeof input === 'string' || input instanceof URL) {
        const url = new URL(String(input));
        if (url.protocol !== protocol) throw nodeWorkerError('ERR_INVALID_PROTOCOL', `Expected ${protocol} but received ${url.protocol}`);
        return url;
    }
    const source = input || options;
    const hostname = source.hostname || source.host || 'localhost';
    const port = source.port ? `:${source.port}` : '';
    return new URL(`${protocol}//${hostname}${port}${source.path || source.pathname || '/'}`);
}

function createTimersModule() {
    const setImmediate = (callback, ...args) => setTimeout(callback, 0, ...args);
    return {
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        setImmediate,
        clearImmediate: clearTimeout,
    };
}

function createTimersPromisesModule(timers) {
    return {
        setTimeout(delay, value, options = {}) {
            return timerPromise(timers.setTimeout, timers.clearTimeout, delay, value, options);
        },
        setImmediate(value, options = {}) {
            return timerPromise(timers.setImmediate, timers.clearImmediate, 0, value, options);
        },
    };
}

function timerPromise(schedule, cancel, delay, value, options) {
    return new Promise((resolve, reject) => {
        if (options?.signal?.aborted) return reject(options.signal.reason || new DOMException('The operation was aborted', 'AbortError'));
        const handle = schedule(() => {
            cleanup();
            resolve(value);
        }, delay);
        const abort = () => {
            cancel(handle);
            cleanup();
            reject(options.signal.reason || new DOMException('The operation was aborted', 'AbortError'));
        };
        const cleanup = () => options?.signal?.removeEventListener?.('abort', abort);
        options?.signal?.addEventListener?.('abort', abort, {once: true});
    });
}

async function sendHttpRequest(fetch, target, options, chunks, callback, requestListeners, Buffer) {
    try {
        const body = chunks.length ? Buffer.concat(chunks) : undefined;
        const response = await fetch(target, {
            method: options.method || (body ? 'POST' : 'GET'),
            headers: options.headers,
            body,
            signal: options.signal,
        });
        const bytes = Buffer.from(await response.arrayBuffer());
        const listeners = new Map();
        const incoming = {
            statusCode: response.status,
            statusMessage: response.statusText,
            headers: Object.fromEntries(response.headers),
            on(name, listener) {
                listeners.set(name, listener);
                if (name === 'data') queueMicrotask(() => listener(bytes));
                if (name === 'end') queueMicrotask(listener);
                return this;
            },
            once(name, listener) {
                return this.on(name, listener);
            },
        };
        callback?.(incoming);
    } catch (error) {
        requestListeners.get('error')?.(error);
    }
}

function createUrlModule() {
    return {
        URL,
        URLSearchParams,
        pathToFileURL(path) {
            return new URL(`file://${displayPath(path)}`);
        },
        fileURLToPath(value) {
            const url = value instanceof URL ? value : new URL(value);
            if (url.protocol !== 'file:') throw new TypeError('URL must use file: protocol');
            return decodeURIComponent(url.pathname);
        },
    };
}

function createQueryStringModule() {
    const result = {
        parse(value, separator = '&', equals = '=') {
            const result = Object.create(null);
            const source = String(value || '');
            if (!source) return result;
            for (const part of source.split(separator)) {
                const index = part.indexOf(equals);
                const key = decodeQueryStringValue(index === -1 ? part : part.slice(0, index));
                const item = decodeQueryStringValue(index === -1 ? '' : part.slice(index + equals.length));
                if (!Object.prototype.hasOwnProperty.call(result, key)) result[key] = item;
                else if (Array.isArray(result[key])) result[key].push(item);
                else result[key] = [result[key], item];
            }
            return result;
        },
        stringify(value, separator = '&', equals = '=') {
            const parts = [];
            for (const [key, rawValue] of Object.entries(value || {})) {
                const values = Array.isArray(rawValue) ? rawValue : [rawValue];
                for (const item of values) {
                    parts.push(`${encodeURIComponent(key)}${equals}${encodeURIComponent(normalizeQueryStringValue(item))}`);
                }
            }
            return parts.join(separator);
        },
        escape: encodeURIComponent,
        unescape: decodeQueryStringValue,
    };
    result.decode = result.parse;
    result.encode = result.stringify;
    return result;
}

function normalizeQueryStringValue(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
    return ['string', 'bigint', 'boolean'].includes(typeof value) ? String(value) : '';
}

function decodeQueryStringValue(value) {
    try {
        return decodeURIComponent(String(value).replace(/\+/g, ' '));
    } catch {
        return String(value).replace(/\+/g, ' ');
    }
}

const HTTP_METHODS = [
    'ACL', 'BIND', 'CHECKOUT', 'CONNECT', 'COPY', 'DELETE', 'GET', 'HEAD', 'LINK', 'LOCK', 'M-SEARCH',
    'MERGE', 'MKACTIVITY', 'MKCALENDAR', 'MKCOL', 'MOVE', 'NOTIFY', 'OPTIONS', 'PATCH', 'POST', 'PROPFIND',
    'PROPPATCH', 'PURGE', 'PUT', 'QUERY', 'REBIND', 'REPORT', 'SEARCH', 'SOURCE', 'SUBSCRIBE', 'TRACE',
    'UNBIND', 'UNLINK', 'UNLOCK', 'UNSUBSCRIBE',
];

const HTTP_STATUS_CODES = {
    100: 'Continue', 101: 'Switching Protocols', 102: 'Processing', 103: 'Early Hints',
    200: 'OK', 201: 'Created', 202: 'Accepted', 203: 'Non-Authoritative Information', 204: 'No Content',
    205: 'Reset Content', 206: 'Partial Content', 207: 'Multi-Status', 208: 'Already Reported', 226: 'IM Used',
    300: 'Multiple Choices', 301: 'Moved Permanently', 302: 'Found', 303: 'See Other', 304: 'Not Modified',
    305: 'Use Proxy', 307: 'Temporary Redirect', 308: 'Permanent Redirect',
    400: 'Bad Request', 401: 'Unauthorized', 402: 'Payment Required', 403: 'Forbidden', 404: 'Not Found',
    405: 'Method Not Allowed', 406: 'Not Acceptable', 407: 'Proxy Authentication Required', 408: 'Request Timeout',
    409: 'Conflict', 410: 'Gone', 411: 'Length Required', 412: 'Precondition Failed', 413: 'Payload Too Large',
    414: 'URI Too Long', 415: 'Unsupported Media Type', 416: 'Range Not Satisfiable', 417: 'Expectation Failed',
    418: "I'm a Teapot", 421: 'Misdirected Request', 422: 'Unprocessable Entity', 423: 'Locked',
    424: 'Failed Dependency', 425: 'Too Early', 426: 'Upgrade Required', 428: 'Precondition Required',
    429: 'Too Many Requests', 431: 'Request Header Fields Too Large', 451: 'Unavailable For Legal Reasons',
    500: 'Internal Server Error', 501: 'Not Implemented', 502: 'Bad Gateway', 503: 'Service Unavailable',
    504: 'Gateway Timeout', 505: 'HTTP Version Not Supported', 506: 'Variant Also Negotiates',
    507: 'Insufficient Storage', 508: 'Loop Detected', 509: 'Bandwidth Limit Exceeded', 510: 'Not Extended',
    511: 'Network Authentication Required',
};

function validateHeaderName(name) {
    const value = String(name);
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(value)) {
        throw httpTypeError('ERR_INVALID_HTTP_TOKEN', `Header name must be a valid HTTP token [\"${value}\"]`);
    }
}

function validateHeaderValue(name, value) {
    if (value === undefined) throw httpTypeError('ERR_HTTP_INVALID_HEADER_VALUE', `Invalid value \"undefined\" for header \"${name}\"`);
    if (/[\0-\x08\x0A-\x1F\x7F]/.test(String(value))) {
        throw httpTypeError('ERR_INVALID_CHAR', `Invalid character in header content [\"${name}\"]`);
    }
}

function httpTypeError(code, message) {
    const error = new TypeError(message);
    error.code = code;
    return error;
}

function createAssertModule() {
    const assert = (value, message = 'Assertion failed') => {
        if (!value) throw new Error(message);
    };
    assert.ok = assert;
    assert.equal = (actual, expected, message) => assert(actual == expected, message || `${actual} != ${expected}`);
    assert.strictEqual = (actual, expected, message) => assert(actual === expected, message || `${actual} !== ${expected}`);
    assert.deepStrictEqual = (actual, expected, message) => assert(
        JSON.stringify(actual) === JSON.stringify(expected),
        message || 'Values are not deeply equal',
    );
    return assert;
}

export {NodeWorker, nodeWorkerError};
