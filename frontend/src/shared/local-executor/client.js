import { normalizeCommandWhitelist, normalizeMainCommands } from "../command-whitelist.js";

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const TASK_ID = /^[a-zA-Z0-9_-]{8,80}$/;

export function isLocalTaskFinished(task) {
    return TERMINAL_STATUSES.has(task?.status);
}

// 连接地址由用户配置，支持本机、局域网及 HTTPS 远程入口。
export function normalizeExecutorUrl(value) {
    if (typeof value !== 'string' || !/^https?:\/\//i.test(value.trim())) throw new Error('Executor address must be an HTTP or HTTPS URL');
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash || url.pathname !== '/' || url.port === '0'
        || ['0.0.0.0', '[::]'].includes(url.hostname)) {
        throw new Error('Executor address must have a reachable host and no credentials, path, query or fragment');
    }
    return url.origin;
}

export function normalizeExecutorListenAddress(value = '127.0.0.1') {
    if (typeof value !== 'string') throw new Error('Listen address must be an IPv4 or IPv6 address');
    const address = value.trim();
    if (/^\d+\.\d+\.\d+\.\d+$/.test(address)) {
        if (address.split('.').every((part) => /^(0|[1-9]\d*)$/.test(part) && Number(part) <= 255)) return address;
    } else if (/^[0-9a-f:]+$/i.test(address) && address.includes(':')) {
        try { return new URL(`http://[${address}]/`).hostname.slice(1, -1); } catch { /* 使用统一的参数错误。 */ }
    }
    throw new Error('Listen address must be an IPv4 or IPv6 address');
}

// 设置只保存可复用配置，不接收连接凭据或任务状态；兼容仅包含白名单的旧设置。
export function normalizeLocalExecutorSettings(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    let listenAddress = '127.0.0.1';
    try {
        const address = normalizeExecutorListenAddress(source.listenAddress);
        if (!['0.0.0.0', '::'].includes(address)) listenAddress = address;
    } catch { /* 非法或缺失地址回退到本机默认值。 */ }
    return {
        whitelist: normalizeCommandWhitelist(source.whitelist),
        listenAddress,
        port: Number.isSafeInteger(source.port) && source.port >= 0 && source.port <= 65535 ? source.port : 0,
        autoApprove: source.autoApprove === true,
    };
}

export function parseLocalConnection(value) {
    let data;
    try { data = typeof value === 'string' ? JSON.parse(value) : value; } catch { throw new Error('Invalid connection JSON'); }
    if (!data || typeof data.url !== 'string' || typeof data.token !== 'string') throw new Error('Connection requires url and token');
    const url = normalizeExecutorUrl(data.url);
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(data.token)) throw new Error('Invalid connection token');
    return {url, token: data.token};
}

export function normalizeLocalWaitSeconds(value = 10) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('wait_seconds must be a non-negative integer');
    return value;
}

export function normalizeLocalCommand({command, cwd = '', reason, shell = '', wait_seconds, commands, high_risk} = {}) {
    if (typeof command !== 'string' || !command.trim() || command.includes('\0') || new TextEncoder().encode(command).length > 65536) throw new Error('Invalid command');
    if (typeof cwd !== 'string' || cwd.includes('\0') || cwd.length > 4096) throw new Error('Invalid working directory');
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 4096) throw new Error('A concise execution reason is required');
    if (!['', 'sh', 'powershell', 'cmd'].includes(shell)) throw new Error('Unsupported shell');
    if (!Array.isArray(commands) || !commands.length || commands.some((name) => typeof name !== 'string' || !name.trim() || /\s/.test(name.trim()))) throw new Error('commands must list the main commands');
    if (typeof high_risk !== 'boolean') throw new Error('high_risk must be a boolean');
    return Object.freeze({command, cwd, reason: reason.trim(), shell, commands: Object.freeze(normalizeMainCommands(commands)), high_risk, wait_seconds: normalizeLocalWaitSeconds(wait_seconds)});
}

export function buildLocalStartupCommand({platform, assetBase, origin, terminal = 'powershell', androidRoot = false, listenAddress = '127.0.0.1', port = 0, publicUrl = ''}) {
    const base = new URL(assetBase);
    if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname))) throw new Error('Serve startup scripts over HTTPS (or localhost for development)');
    const listen = normalizeExecutorListenAddress(listenAddress);
    if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer from 0 to 65535');
    const advertised = publicUrl ? normalizeExecutorUrl(publicUrl) : '';
    if (['0.0.0.0', '::'].includes(listen) && !advertised) throw new Error('An access URL is required when listening on all interfaces');
    const webOrigin = new URL(origin).origin;
    const url = base.href.replace(/\/$/, '');
    const sh = (text) => `'${text.replace(/'/g, `'"'"'`)}'`;
    const ps = (text) => `'${text.replace(/'/g, "''")}'`;
    if (platform === 'windows') {
        // 从原始响应流按 UTF-8 解码，不能将可能为 byte[] 的 Content 转成字符串。
        const script = `& ([scriptblock]::Create([Text.Encoding]::UTF8.GetString((Invoke-WebRequest -UseBasicParsing ${ps(`${url}/bootstrap.ps1`)}).RawContentStream.ToArray()))) -BaseUrl ${ps(url)} -Origin ${ps(webOrigin)} -ListenAddress ${ps(listen)} -Port ${port}${advertised ? ` -PublicUrl ${ps(advertised)}` : ''}`;
        if (terminal === 'cmd') {
            // 编码的是固定启动脚本，避免 CMD 再次解释 URL 中的引号、百分号和连接符。
            const bytes = Uint8Array.from({length: script.length * 2}, (_, index) => script.charCodeAt(index >> 1) >> ((index & 1) * 8) & 255);
            return `powershell.exe -NoLogo -NoProfile -EncodedCommand ${btoa(String.fromCharCode(...bytes))}`;
        }
        return script;
    }
    if (platform === 'android') {
        // 页面只负责下载入口，默认参数由启动脚本提供。
        const args = [sh(url), sh(webOrigin)];
        if (listen !== '127.0.0.1' || port !== 0 || advertised) args.push(sh(listen));
        if (port !== 0 || advertised) args.push(String(port));
        if (advertised) args.push(sh(advertised));
        const launch = `sh -s -- ${args.join(' ')}`;
        // su -c 增加一层 Shell 解析，转义外层双引号，保持 URL 和参数原样传入。
        const runner = androidRoot === true ? `su -c "${launch.replace(/["\\$`]/g, '\\$&')}"` : launch;
        return `curl -fsSL ${sh(`${url}/bootstrap-android.sh`)} | ${runner}`;
    }
    // 启动参数只来自页面配置，不拼接模型提供的命令。
    return `curl -fsSL ${sh(`${url}/bootstrap.sh`)} | sh -s -- ${sh(url)} ${sh(webOrigin)} ${sh(listen)} ${port} ${sh(advertised)}`;
}

export class LocalExecutorClient {
    #connection;
    #fetch;
    constructor(connection, {fetchImpl = globalThis.fetch} = {}) {
        this.#connection = parseLocalConnection(connection);
        this.#fetch = fetchImpl.bind(globalThis);
    }
    get url() { return this.#connection.url; }
    async request(path, {method = 'GET', body, signal, keepalive = false} = {}) {
        const controller = new AbortController();
        const abort = () => controller.abort(signal?.reason);
        signal?.addEventListener('abort', abort, {once: true});
        if (signal?.aborted) abort();
        const timer = setTimeout(() => controller.abort(new Error('Executor request timed out')), 12000);
        try {
            const response = await this.#fetch(this.url + path, {
                method, mode: 'cors', credentials: 'omit', redirect: 'error', cache: 'no-store', keepalive,
                headers: {Authorization: `Bearer ${this.#connection.token}`, ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
                body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal,
            });
            const data = await response.json();
            if (!response.ok) throw Object.assign(new Error(typeof data.error === 'string' ? data.error : `Executor HTTP ${response.status}`), {status: response.status});
            return data;
        } catch (error) {
            if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
            if (error instanceof TypeError) throw new Error('Cannot reach the executor. Check its IP, port, listener and network connectivity.');
            throw error;
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
        }
    }
    async info(signal) {
        const info = await this.request('/v1/info', {signal});
        if (info.protocol_version !== 1 || typeof info.default_cwd !== 'string' || !['python', 'powershell', 'android'].includes(info.runtime)) throw new Error('Unsupported executor protocol');
        return info;
    }
    submit(task, signal) { return this.request('/v1/tasks', {method: 'POST', body: task, signal}); }
    read(id, cursor = 0, signal) {
        this.validateTask(id);
        if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('Invalid output cursor');
        return this.request(`/v1/tasks/${id}?cursor=${cursor}`, {signal});
    }
    cancel(id, {signal, keepalive = false} = {}) {
        this.validateTask(id);
        return this.request(`/v1/tasks/${id}/cancel`, {method: 'POST', body: {}, signal, keepalive});
    }
    validateTask(id) { if (typeof id !== 'string' || !TASK_ID.test(id)) throw new Error('Invalid task id'); }
}
