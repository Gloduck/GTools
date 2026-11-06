import {reactive, watch} from 'vue';
import {isLocalTaskFinished, LocalExecutorClient, normalizeLocalWaitSeconds} from './client.js';

// 仅将非敏感展示状态放入响应式对象；凭据不进入设置、
// 会话序列化、模型上下文、URL 或组件属性。
export function createLocalExecutorSession({onFinished = () => {}, heartbeatMs = 5000} = {}) {
    const state = reactive({connected: false, connecting: false, reachable: false, shell: '', info: null, url: '', error: '', whitelistText: '', autoApprove: false, bindWorkspace: false, tasks: []});
    let client = null;
    let generation = 0;
    let timer = null;
    let lastHeartbeat = 0;
    const owners = new Map();
    const finished = new Set();
    const waiting = new Set();
    function apply(task, snapshot) {
        if (snapshot.id !== task.id || !Number.isSafeInteger(snapshot.cursor) || snapshot.cursor < task.cursor) throw new Error('Invalid task response');
        task.status = snapshot.status;
        task.exit_code = snapshot.exit_code;
        task.error = snapshot.error || '';
        task.truncated ||= !!snapshot.truncated;
        task.has_more = snapshot.has_more;
        task.cwd = snapshot.cwd;
        task.cursor = snapshot.cursor;
        const output = (snapshot.output_lost ? '' : task.output) + snapshot.output;
        task.output_lost ||= !!snapshot.output_lost || output.length > 100000;
        task.truncated ||= output.length > 100000;
        task.output = output.slice(-100000);
        if (isLocalTaskFinished(task) && !finished.has(task.id)) {
            finished.add(task.id);
            Promise.resolve(onFinished(task, owners.get(task.id))).catch(() => {});
        }
    }
    async function poll() {
        if (!client) return;
        const current = client;
        const version = generation;
        try {
            if (Date.now() - lastHeartbeat >= heartbeatMs) {
                await current.info();
                if (version !== generation) return;
                lastHeartbeat = Date.now();
                state.reachable = true;
            }
            for (const task of state.tasks) {
                if (task.status !== 'submitting' && (!isLocalTaskFinished(task) || task.has_more)) {
                    try {
                        const result = await current.read(task.id, task.cursor);
                        if (version !== generation) return;
                        apply(task, result);
                    } catch (error) {
                        if (version !== generation) return;
                        task.error = error.message;
                        if (error.status === 404) {
                            task.status = 'failed';
                            task.error = '任务记录不存在，执行结果无法确认。请检查终端，不要自动重跑命令。';
                            task.has_more = false;
                        }
                        // 单个任务读取失败不能阻塞其他任务的取消结果和输出。
                    }
                }
            }
            state.error = '';
        } catch (error) {
            if (version === generation) { state.error = error.message; state.reachable = false; }
        } finally {
            if (version === generation && client) timer = setTimeout(poll, waiting.size ? 100 : 1000);
        }
    }
    // 等待复用后台查询结果，避免同一任务并发读取同一游标、重复拼接输出。
    // 这里只决定工具何时返回，不向执行端传递执行时长限制。
    function waitForTask(task, seconds, version, signal) {
        return new Promise((resolve, reject) => {
            let timer;
            let stopWatching = () => {};
            let settled = false;
            const deadline = performance.now() + seconds * 1000;
            function finish(error) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                stopWatching();
                signal?.removeEventListener('abort', onAbort);
                waiting.delete(task.id);
                if (error) reject(error); else resolve();
            }
            function onAbort() { finish(signal.reason || new DOMException('Aborted', 'AbortError')); }
            function check() {
                if (signal?.aborted) return onAbort();
                if (version !== generation) return finish(new Error('Connection changed during execution'));
                if (task.error || !state.reachable || (isLocalTaskFinished(task) && !task.has_more)) finish();
            }
            function checkDeadline() {
                if (settled) return;
                const remaining = deadline - performance.now();
                if (remaining <= 0) return finish();
                // 分段计时，较长等待不会触发浏览器 setTimeout 的整数溢出。
                timer = setTimeout(checkDeadline, Math.min(remaining, 60000));
            }
            waiting.add(task.id);
            stopWatching = watch(() => [state.connected, state.reachable, task.status, task.has_more, task.error], check);
            signal?.addEventListener('abort', onAbort, {once: true});
            check();
            checkDeadline();
        });
    }
    function disconnect({cancel = true} = {}) {
        generation++;
        clearTimeout(timer);
        const previous = client;
        if (previous && cancel) {
            for (const task of state.tasks.filter((item) => !isLocalTaskFinished(item))) {
                previous.cancel(task.id, {keepalive: true}).catch(() => {});
            }
        }
        client = null;
        owners.clear();
        finished.clear();
        // 清理当前连接的授权状态；重新配对时由页面应用用户保存的配置。
        Object.assign(state, {connected: false, connecting: false, reachable: false, shell: '', info: null, url: '', error: '', whitelistText: '', autoApprove: false, bindWorkspace: false, tasks: []});
    }
    return {
        state,
        get generation() { return generation; },
        async connect(value) {
            if (client || state.connecting) throw new Error('Disconnect the current executor before connecting again');
            state.connecting = true;
            state.error = '';
            const version = generation;
            try {
                const candidate = new LocalExecutorClient(value);
                const info = await candidate.info();
                if (version !== generation) return;
                client = candidate;
                Object.assign(state, {connected: true, reachable: true, shell: info.shell, info, url: candidate.url, whitelistText: '', autoApprove: false});
                lastHeartbeat = Date.now();
                timer = setTimeout(poll, 1000);
            } catch (error) {
                if (version === generation) state.error = error.message;
                throw error;
            } finally { if (version === generation) state.connecting = false; }
        },
        disconnect,
        async execute(args, owner, signal) {
            if (!client || !state.reachable) throw new Error('Executor is not connected');
            const waitSeconds = normalizeLocalWaitSeconds(args.wait_seconds);
            if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
            const current = client;
            const version = generation;
            const id = crypto.randomUUID();
            const shell = args.shell || state.shell || state.info.shell;
            if (!(state.info.shells || [state.info.shell]).includes(shell)) throw new Error('Shell is unavailable on this connection');
            const task = reactive({id, shell, command: args.command, reason: args.reason || '', cwd: args.cwd || state.info.default_cwd, status: 'submitting', output: '', cursor: 0, has_more: false, exit_code: null, error: '', truncated: false, output_lost: false});
            state.tasks.unshift(task);
            owners.set(id, owner);
            try {
                const result = await current.submit({id, command: args.command, cwd: args.cwd, shell}, signal);
                if (version !== generation) {
                    current.cancel(id).catch(() => {});
                    throw new Error('Connection changed during execution');
                }
                apply(task, result);
            } catch (error) {
                // 响应丢失不代表任务未执行。保留编号用于查询，
                // 不自动重新提交命令。
                const rejected = [400, 401, 403, 409, 410, 413, 415, 429].includes(error.status);
                task.status = rejected ? 'failed' : 'unknown';
                task.error = error.message;
                if (rejected) throw error;
                if (signal?.aborted || version !== generation) {
                    current.cancel(id).catch(() => {});
                    throw error;
                }
                return {task_id: id, status: 'unknown', summary: `Executor task submission outcome unknown. Read this task id; do not repeat the command automatically. ${error.message}`};
            }
            try {
                await waitForTask(task, waitSeconds, version, signal);
            } catch (error) {
                // 用户停止等待中的 AI 调用时请求取消任务；等待窗口到期不会进入这里。
                if (signal?.aborted && version === generation && !isLocalTaskFinished(task)) current.cancel(id).catch(() => {});
                throw error;
            }
            const error = task.error || (!state.reachable ? state.error : '');
            const status = error && !isLocalTaskFinished(task) ? 'unknown' : task.status;
            return {task_id: id, status, shell, cwd: task.cwd, cursor: task.cursor, output: task.output,
                exit_code: task.exit_code, error, has_more: task.has_more, truncated: task.truncated, output_lost: task.output_lost,
                summary: `Executor command ${status}`};
        },
        async read(id, cursor, owner, signal) {
            if (!client) throw new Error('No executor connection');
            if (owners.get(id)?.sessionId !== owner.sessionId) throw new Error('Task does not belong to this AI session');
            const result = await client.read(id, cursor, signal);
            return {...result, task_id: id, summary: `Executor task ${result.status}`};
        },
        async cancel(id, owner) {
            if (!client) throw new Error('No executor connection');
            if (owner && owners.get(id)?.sessionId !== owner.sessionId) throw new Error('Task does not belong to this AI session');
            const result = await client.cancel(id);
            const task = state.tasks.find((item) => item.id === id);
            if (task) { task.status = result.status; task.has_more = true; }
            return {...result, task_id: id, summary: `Cancellation requested; task is ${result.status}`};
        },
        dispose() { disconnect(); },
    };
}
