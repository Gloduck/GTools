import {
    getFileName,
    getMimeType,
    getParentFilePath,
    isPathUnder,
    joinFilePath,
    normalizeFilePath,
} from '../../file-utils.js';
import {FileSystemProvider} from '../file-system-provider.js';
import {
    FileAlreadyExistsError,
    FileConflictError,
    FileDirectoryNotEmptyError,
    FileIsDirectoryError,
    FileNotFoundError,
    FileNotDirectoryError,
    FilePermissionError,
    FileSystemError,
    FileUnsupportedError,
} from '../file-system-errors.js';

class BrowserHandleProvider extends FileSystemProvider {
    #root;

    constructor({root, handle, directoryHandle} = {}) {
        super();
        root ||= handle || directoryHandle;
        if (!root || root.kind !== 'directory') throw new TypeError('BrowserHandleProvider requires a FileSystemDirectoryHandle');
        this.#root = root;
    }

    getCapabilities() {
        return {
            ...super.getCapabilities(),
            read: true,
            write: true,
            streamingRead: true,
            streamingWrite: true,
            directories: true,
            createDirectory: true,
            emptyDirectories: true,
            removeFile: true,
            removeDirectory: true,
            recursiveRemove: true,
            copy: true,
            copyDirectory: true,
            copyTargetValidation: true,
            move: true,
            moveDirectory: true,
            atomicMove: false,
            optimisticLocking: true,
            versionPrecondition: 'best-effort',
        };
    }

    async checkAccess(path = '', options = {}) {
        const {writable = false, request = false} = options;
        throwIfAborted(options.signal);
        const mode = writable ? 'readwrite' : 'read';
        const method = request ? 'requestPermission' : 'queryPermission';
        if (typeof this.#root[method] !== 'function') return true;
        const permission = await this.#root[method]({mode});
        if (permission !== 'granted') throw new FilePermissionError(normalizeFilePath(path), {permission});
        return true;
    }

    async isCopyDestinationInside(sourcePath, destinationProvider, destinationPath, options = {}) {
        throwIfAborted(options.signal);
        if (!(destinationProvider instanceof BrowserHandleProvider)) return false;
        const normalizedSourcePath = normalizeFilePath(sourcePath);
        const normalizedDestinationPath = normalizeFilePath(destinationPath);
        try {
            if (typeof this.#root.resolve === 'function') {
                const destinationRootPath = await this.#root.resolve(destinationProvider.#root);
                if (Array.isArray(destinationRootPath)) {
                    const resolvedDestinationPath = joinFilePath(...destinationRootPath, normalizedDestinationPath);
                    if (isPathUnder(resolvedDestinationPath, normalizedSourcePath)) return true;
                }
            }

            const source = await this.#getDirectory(normalizedSourcePath);
            let candidatePath = normalizedDestinationPath;
            let destination = null;
            while (!destination) {
                try {
                    destination = await destinationProvider.#getDirectory(candidatePath);
                } catch (error) {
                    if (!isMissingOrWrongKind(error)) throw error;
                    const parentPath = getParentFilePath(candidatePath);
                    if (parentPath === candidatePath) return false;
                    candidatePath = parentPath;
                }
            }
            return typeof source.resolve === 'function' && Array.isArray(await source.resolve(destination));
        } catch (error) {
            if (isMissingOrWrongKind(error)) return false;
            throw translateHandleError(error, normalizedSourcePath);
        }
    }

    async isSameFileTarget(path, target, options = {}) {
        throwIfAborted(options.signal);
        if (!target || target.kind !== 'file' || typeof target.isSameEntry !== 'function') return false;
        const normalizedPath = normalizeFilePath(path);
        try {
            const parent = await this.#getDirectory(getParentFilePath(normalizedPath));
            const source = await parent.getFileHandle(getFileName(normalizedPath));
            return Boolean(await target.isSameEntry(source));
        } catch (error) {
            if (isMissingOrWrongKind(error)) return false;
            throw translateHandleError(error, normalizedPath);
        }
    }

    async stat(path = '', options = {}) {
        throwIfAborted(options.signal);
        const normalizedPath = normalizeFilePath(path);
        if (normalizedPath === '') {
            return {path: '', name: this.#root.name || '', kind: 'directory', size: 0, mimeType: null, version: null};
        }

        try {
            const handle = await this.#getEntry(normalizedPath);
            if (handle.kind === 'directory') {
                return {path: normalizedPath, name: handle.name, kind: 'directory', size: 0, mimeType: null, version: null};
            }
            const file = await handle.getFile();
            return fileEntry(normalizedPath, file);
        } catch (error) {
            throw translateHandleError(error, normalizedPath);
        }
    }

    async list(path = '', options = {}) {
        const {limit = Infinity} = options;
        throwIfAborted(options.signal);
        const normalizedPath = normalizeFilePath(path);
        try {
            const directory = await this.#getDirectory(normalizedPath);
            const entries = [];
            for await (const [name, handle] of directory.entries()) {
                const entryPath = joinFilePath(normalizedPath, name);
                // Callers listing only names need not open every file to obtain its size.
                if (handle.kind === 'directory' || options.withMetadata === false) {
                    entries.push({path: entryPath, name, kind: handle.kind, size: 0, mimeType: null, version: null});
                } else {
                    entries.push(fileEntry(entryPath, await handle.getFile()));
                }
            }
            return entries
                .sort((left, right) => left.name.localeCompare(right.name))
                .slice(0, limit);
        } catch (error) {
            if (error?.name === 'TypeMismatchError') {
                throw new FileNotDirectoryError(normalizedPath, {operation: 'list', cause: error});
            }
            throw translateHandleError(error, normalizedPath);
        }
    }

    async openRead(path, options = {}) {
        throwIfAborted(options.signal);
        const normalizedPath = normalizeFilePath(path);
        try {
            const parent = await this.#getDirectory(getParentFilePath(normalizedPath));
            const handle = await parent.getFileHandle(getFileName(normalizedPath));
            const file = await handle.getFile();
            return {
                ...fileEntry(normalizedPath, file),
                blob: file,
                stream: file.stream(),
            };
        } catch (error) {
            if (error?.name === 'TypeMismatchError') {
                throw new FileIsDirectoryError(normalizedPath, {operation: 'openRead', cause: error});
            }
            throw translateHandleError(error, normalizedPath);
        }
    }

    async openWrite(path, options = {}) {
        throwIfAborted(options.signal);
        const normalizedPath = normalizeFilePath(path);
        await this.#checkExpectedVersion(normalizedPath, options.expectedVersion);

        let writable;
        try {
            const parent = await this.#getDirectory(getParentFilePath(normalizedPath), options.createParents === true);
            const handle = await parent.getFileHandle(getFileName(normalizedPath), {create: true});
            writable = await handle.createWritable();
            return {
                stream: writable,
                commit: async () => {
                    try {
                        await writable.close();
                        return await this.stat(normalizedPath);
                    } catch (error) {
                        throw translateHandleError(error, normalizedPath);
                    }
                },
                abort: async (reason) => {
                    if (typeof writable.abort === 'function') await writable.abort(reason);
                },
            };
        } catch (error) {
            if (writable && typeof writable.abort === 'function') {
                try {
                    await writable.abort(error);
                } catch {
                }
            }
            throw translateHandleError(error, normalizedPath);
        }
    }

    async write(path, blob, options = {}) {
        const opened = await this.openWrite(path, options);
        try {
            await blob.stream().pipeTo(opened.stream, {
                preventClose: true,
                ...(options.signal ? {signal: options.signal} : {}),
            });
            return await opened.commit();
        } catch (error) {
            try {
                await opened.abort(error);
            } catch {
            }
            throw error;
        }
    }

    async createDirectory(path, options = {}) {
        const {recursive = false} = options;
        throwIfAborted(options.signal);
        const normalizedPath = normalizeFilePath(path);
        if (normalizedPath === '') return this.stat('');
        try {
            if (recursive) {
                await this.#getDirectory(normalizedPath, true);
            } else {
                const parent = await this.#getDirectory(getParentFilePath(normalizedPath));
                await parent.getDirectoryHandle(getFileName(normalizedPath), {create: true});
            }
            return this.stat(normalizedPath);
        } catch (error) {
            throw translateHandleError(error, normalizedPath);
        }
    }

    async remove(path, options = {}) {
        throwIfAborted(options.signal);
        const normalizedPath = normalizeFilePath(path);
        if (normalizedPath === '') throw new FileSystemError('Cannot remove the file system root', {
            code: 'INVALID_FILE_PATH',
            path: normalizedPath,
        });
        let state;
        try {
            state = await this.#checkExpectedVersion(normalizedPath, options.expectedVersion);
        } catch (error) {
            if (options.force === true && error?.code === FileNotFoundError.code) return false;
            throw error;
        }
        if (!state.exists) {
            if (options.force === true) return false;
            throw new FileNotFoundError(normalizedPath);
        }
        if (options.kind) {
            const entry = state.entry;
            if (options.kind === 'file' && entry.kind === 'directory') {
                throw new FileIsDirectoryError(normalizedPath, {operation: 'remove'});
            }
            if (options.kind === 'directory' && entry.kind === 'file') {
                throw new FileNotDirectoryError(normalizedPath, {operation: 'remove'});
            }
        }
        try {
            const parent = await this.#getDirectory(getParentFilePath(normalizedPath));
            const name = getFileName(normalizedPath);
            let handle = null;
            if (options.kind === 'file') {
                try {
                    handle = await parent.getFileHandle(name);
                } catch (error) {
                    if (error?.name === 'TypeMismatchError') {
                        throw new FileIsDirectoryError(normalizedPath, {operation: 'remove', cause: error});
                    }
                    throw error;
                }
            } else if (options.kind === 'directory') {
                try {
                    handle = await parent.getDirectoryHandle(name);
                } catch (error) {
                    if (error?.name === 'TypeMismatchError') {
                        throw new FileNotDirectoryError(normalizedPath, {operation: 'remove', cause: error});
                    }
                    throw error;
                }
            }
            const recursive = options.kind === 'file' ? false : options.recursive === true;
            if (handle && typeof handle.remove === 'function') await handle.remove({recursive});
            else await parent.removeEntry(name, {recursive});
            return true;
        } catch (error) {
            const translated = translateHandleError(error, normalizedPath);
            if (options.force === true && translated.code === FileNotFoundError.code) return false;
            if (error?.name === 'InvalidModificationError') {
                throw new FileDirectoryNotEmptyError(normalizedPath, {operation: 'remove', cause: error});
            }
            throw translated;
        }
    }

    async copy(sourcePath, destinationPath, options = {}) {
        const source = normalizeFilePath(sourcePath);
        const destination = normalizeFilePath(destinationPath);
        throwIfAborted(options.signal);
        if (source === destination) throw new FileAlreadyExistsError(destination, {operation: 'copy'});
        const sourceEntry = await this.stat(source, options);
        assertExpectedVersion(source, sourceEntry.version, selectExpectedVersion(options.sourceExpectedVersion, options.expectedVersion));
        if (sourceEntry.kind === 'directory'
            && (isPathUnder(destination, source) || isPathUnder(source, destination))) {
            throw new FileSystemError(`Cannot copy between overlapping directories: ${source} -> ${destination}`, {
                code: 'INVALID_FILE_OPERATION',
                operation: 'copy',
                path: source,
                destinationPath: destination,
            });
        }
        return this.#copyEntry(sourceEntry, destination, options, true);
    }

    async move(sourcePath, destinationPath, options = {}) {
        const source = normalizeFilePath(sourcePath);
        const destination = normalizeFilePath(destinationPath);
        throwIfAborted(options.signal);
        const sourceEntry = await this.stat(source, options);
        const sourceExpectedVersion = selectExpectedVersion(options.sourceExpectedVersion, options.expectedVersion);
        assertExpectedVersion(source, sourceEntry.version, sourceExpectedVersion);
        if (options.destinationExpectedVersion !== undefined && source === destination) {
            assertExpectedVersion(destination, sourceEntry.version, options.destinationExpectedVersion);
        }
        if (source === destination) return sourceEntry;
        if (source === '') throw new FileSystemError('Cannot move the file system root', {
            code: 'INVALID_FILE_OPERATION',
            operation: 'move',
            path: source,
            destinationPath: destination,
        });

        const sourceManifest = sourceEntry.kind === 'directory'
            ? await this.#collectEntryTree(sourceEntry, options)
            : [sourceEntry];
        const copied = await this.copy(source, destination, {...options, sourceExpectedVersion});
        if (sourceEntry.kind === 'directory') {
            const currentManifest = await this.#collectEntryTree(await this.stat(source, options), options);
            assertManifestUnchanged(source, sourceManifest, currentManifest);
            await this.#removeManifest(sourceManifest, options);
        } else {
            await this.remove(source, {
                ...copyMutationOptions(options),
                expectedVersion: sourceExpectedVersion !== undefined ? sourceExpectedVersion : sourceEntry.version,
                kind: 'file',
            });
        }
        return copied;
    }

    async #copyEntry(sourceEntry, destinationPath, options, root) {
        throwIfAborted(options.signal);
        const destinationEntry = await this.#optionalStat(destinationPath, options);
        const destinationExpectedVersion = root ? options.destinationExpectedVersion : undefined;
        if (destinationExpectedVersion !== undefined) {
            assertExpectedVersion(destinationPath, destinationEntry?.version ?? null, destinationExpectedVersion);
        }

        if (sourceEntry.kind === 'file') {
            if (destinationEntry?.kind === 'directory') throw new FileIsDirectoryError(destinationPath, {operation: 'copy'});
            if (destinationEntry && options.overwrite !== true) throw new FileAlreadyExistsError(destinationPath, {operation: 'copy'});
            const opened = await this.openRead(sourceEntry.path, options);
            if (opened.version !== sourceEntry.version) {
                throw new FileConflictError(sourceEntry.path, {
                    expectedVersion: sourceEntry.version,
                    actualVersion: opened.version,
                });
            }
            return this.write(destinationPath, opened.blob, {
                ...copyMutationOptions(options),
                createParents: true,
                expectedVersion: destinationEntry?.version ?? null,
                mimeType: opened.mimeType,
            });
        }

        if (options.recursive !== true) {
            throw new FileUnsupportedError('copyDirectory', {
                path: sourceEntry.path,
                message: `Copying a directory requires recursive: true: ${sourceEntry.path}`,
            });
        }
        if (destinationEntry?.kind === 'file') {
            if (options.overwrite !== true) throw new FileAlreadyExistsError(destinationPath, {operation: 'copy'});
            await this.remove(destinationPath, {
                ...copyMutationOptions(options),
                expectedVersion: destinationEntry.version,
                kind: 'file',
            });
        }
        if (destinationEntry?.kind !== 'directory') {
            await this.createDirectory(destinationPath, {...copyMutationOptions(options), recursive: true});
        }
        for (const child of await this.list(sourceEntry.path, {...options, limit: Infinity})) {
            await this.#copyEntry(child, joinFilePath(destinationPath, child.name), {
                ...options,
                sourceExpectedVersion: undefined,
                destinationExpectedVersion: undefined,
                expectedVersion: undefined,
            }, false);
        }
        return this.stat(destinationPath, options);
    }

    async #optionalStat(path, options) {
        try {
            return await this.stat(path, options);
        } catch (error) {
            if (error?.code === FileNotFoundError.code) return null;
            throw error;
        }
    }

    async #collectEntryTree(rootEntry, options) {
        const result = [rootEntry];
        const directories = rootEntry.kind === 'directory' ? [rootEntry] : [];
        while (directories.length > 0) {
            throwIfAborted(options.signal);
            const directory = directories.shift();
            for (const child of await this.list(directory.path, {...options, limit: Infinity})) {
                result.push(child);
                if (child.kind === 'directory') directories.push(child);
            }
        }
        return result;
    }

    async #removeManifest(manifest, options) {
        const entries = [...manifest].sort((left, right) => {
            const depthDifference = pathDepth(right.path) - pathDepth(left.path);
            if (depthDifference !== 0) return depthDifference;
            if (left.kind !== right.kind) return left.kind === 'file' ? -1 : 1;
            return right.path.localeCompare(left.path);
        });
        for (const entry of entries) {
            throwIfAborted(options.signal);
            await this.remove(entry.path, {
                ...copyMutationOptions(options),
                expectedVersion: entry.version,
                kind: entry.kind,
            });
        }
    }

    async #getDirectory(path, create = false) {
        let directory = this.#root;
        for (const name of normalizeFilePath(path).split('/').filter(Boolean)) {
            directory = await directory.getDirectoryHandle(name, {create});
        }
        return directory;
    }

    async #getEntry(path) {
        const parent = await this.#getDirectory(getParentFilePath(path));
        const name = getFileName(path);
        try {
            return await parent.getFileHandle(name);
        } catch (error) {
            if (!isMissingOrWrongKind(error)) throw error;
        }
        return parent.getDirectoryHandle(name);
    }

    async #checkExpectedVersion(path, expectedVersion) {
        let exists = true;
        let actualVersion = null;
        let entry = null;
        try {
            entry = await this.stat(path);
            actualVersion = entry.version;
        } catch (error) {
            if (error?.code !== FileNotFoundError.code) throw error;
            exists = false;
        }
        if (expectedVersion !== undefined && expectedVersion !== actualVersion) {
            throw new FileConflictError(path, {expectedVersion, actualVersion});
        }
        return {exists, version: actualVersion, entry};
    }
}

function fileEntry(path, file) {
    return {
        path,
        name: getFileName(path),
        kind: 'file',
        size: file.size,
        mimeType: file.type || getMimeType(path),
        version: `${file.lastModified}:${file.size}`,
        lastModified: file.lastModified,
    };
}

function isMissingOrWrongKind(error) {
    return error?.name === 'NotFoundError' || error?.name === 'TypeMismatchError';
}

function translateHandleError(error, path) {
    if (error instanceof FileSystemError) return error;
    if (error?.name === 'NotFoundError') return new FileNotFoundError(path, {cause: error});
    if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
        return new FilePermissionError(path, {cause: error});
    }
    return new FileSystemError(error?.message || `File system operation failed: ${path}`, {
        code: 'FILE_SYSTEM_ERROR',
        path,
        cause: error,
    });
}

function throwIfAborted(signal) {
    signal?.throwIfAborted?.();
    if (signal?.aborted) {
        const error = signal.reason instanceof Error ? signal.reason : new Error('Aborted');
        error.name = 'AbortError';
        throw error;
    }
}

function assertExpectedVersion(path, actualVersion, expectedVersion) {
    if (expectedVersion !== undefined && expectedVersion !== actualVersion) {
        throw new FileConflictError(path, {expectedVersion, actualVersion});
    }
}

function selectExpectedVersion(primary, fallback) {
    return primary !== undefined ? primary : fallback;
}

function assertManifestUnchanged(path, expected, actual) {
    const summarize = (entries) => entries
        .map((entry) => `${entry.path}\0${entry.kind}\0${entry.version ?? ''}`)
        .sort();
    const expectedSummary = summarize(expected);
    const actualSummary = summarize(actual);
    if (expectedSummary.length !== actualSummary.length
        || expectedSummary.some((value, index) => value !== actualSummary[index])) {
        throw new FileConflictError(path, {
            message: `Source changed while moving: ${path}`,
            expectedEntries: expectedSummary,
            actualEntries: actualSummary,
        });
    }
}

function pathDepth(path) {
    return path ? path.split('/').length : 0;
}

function copyMutationOptions(options) {
    const {
        expectedVersion,
        sourceExpectedVersion,
        destinationExpectedVersion,
        limit,
        overwrite,
        recursive,
        kind,
        ...result
    } = options;
    return result;
}

export {BrowserHandleProvider};
