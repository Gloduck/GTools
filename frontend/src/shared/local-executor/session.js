import {reactive, watch} from 'vue';
import {t} from '../../i18n/index.js';
import {isLocalTaskFinished, LocalExecutorClient, normalizeLocalWaitSeconds, normalizeLocalMaxChars, normalizeLocalLifecycle, LOCAL_OUTPUT_MAX_CHARS} from './client.js';

const tr = (key, params) => t(`codeEditor.${key}`, params);

// 摘要会进入后续对话；仅从本次真实响应摘取游标，不能复用页面轮询位置。
function formatTaskResult(endpoint, task, snapshot = {}, extra = {}) {
    const result = {ok: !extra.output_unavailable && extra.execution_state !== 'not_started', task_id: task.id, endpoint, lifecycle: task.lifecycle, shell: task.shell, cwd: task.cwd,
        ...snapshot, ...extra};
    result.status ||= 'unknown';
    if (result.status === 'unknown' && result.error) result.ok = false;
    const details = [tr(`ai.summary.state.${result.status}`)];
    if (result.lifecycle) details.push(tr('ai.summary.localLifecycle', {lifecycle: tr(`local.lifecycle.${result.lifecycle}`)}));
    if (result.exit_code !== undefined && result.exit_code !== null) details.push(tr('ai.summary.localExit', {code: result.exit_code}));
    if (Number.isSafeInteger(snapshot.cursor)) details.push(tr('ai.summary.localCursor', {cursor: snapshot.cursor, more: tr(snapshot.has_more ? 'ai.summary.yes' : 'ai.summary.no')}));
    if (extra.cancel_requested) details.push(tr('ai.summary.localCancelRequested'));
    if (result.error) details.push(tr('ai.summary.error', {error: String(result.error).slice(0, 500)}));
    result.summary = tr('ai.summary.localTask', {id: task.id, endpoint, details: details.join('; ')});
    if (result.execution_state === 'not_started') result.summary += ` ${tr('ai.summary.localNotStarted')}`;
    else if (result.output_unavailable || result.status === 'unknown') result.summary += ` ${tr('ai.summary.localUnconfirmed')}`;
    else if (!isLocalTaskFinished(result)) result.summary += ` ${tr('ai.summary.localRunning')}`;
    return result;
}

// 仅将非敏感展示状态放入响应式对象；凭据不进入设置、
// 会话序列化、模型上下文、URL 或组件属性。
export function createLocalExecutorSession({heartbeatMs = 5000} = {}) {
    const state = reactive({connected: false, connecting: false, reachable: false, shell: '', info: null, url: '', error: '', whitelistText: '', autoApprove: false, autoReview: false, tasks: []});
    let client = null;
    let generation = 0;
    let timer = null;
    let lastHeartbeat = 0;
    const owners = new Map();
    const waiting = new Set();
    function apply(task, snapshot) {
        if (snapshot.id !== task.id || !Number.isSafeInteger(snapshot.cursor) || snapshot.cursor < task.cursor) throw new Error('Invalid task response');
        task.status = snapshot.status;
        task.lifecycle = snapshot.lifecycle;
        task.created_at = snapshot.created_at;
        task.exit_code = snapshot.exit_code;
        task.error = snapshot.error || '';
        task.truncated ||= !!snapshot.truncated;
        task.decoding_loss ||= !!snapshot.decoding_loss;
        task.has_more = snapshot.has_more;
        task.cwd = snapshot.cwd;
        task.cursor = snapshot.cursor;
        const output = (snapshot.output_lost ? '' : task.output) + snapshot.output;
        task.output_lost ||= !!snapshot.output_lost || output.length > 100000;
        task.truncated ||= output.length > 100000;
        task.output = output.slice(-100000);
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
                        const result = await current.read(task.id, task.cursor, undefined, LOCAL_OUTPUT_MAX_CHARS);
                        if (version !== generation) return;
                        apply(task, result);
                    } catch (error) {
                        if (version !== generation) return;
                        task.error = error.message;
                        if (error.status === 404) {
                            task.status = 'unknown';
                            task.error = tr('ai.summary.localMissing');
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
                if (task.error || !state.reachable || isLocalTaskFinished(task)) finish();
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
        // 清理当前连接的授权状态；重新配对时由页面应用用户保存的配置。
        Object.assign(state, {connected: false, connecting: false, reachable: false, shell: '', info: null, url: '', error: '', whitelistText: '', autoApprove: false, autoReview: false, tasks: []});
    }
    async function finishInterruptedTask(current, task, version, maxChars) {
        let cancelRequested = false;
        let cancellationError = '';
        if (task.lifecycle === 'task' && !isLocalTaskFinished(task)) {
            cancelRequested = true;
            try {
                const result = await current.cancel(task.id);
                if (version === generation) task.status = result.status;
            } catch (error) {
                cancellationError = error.message;
            }
        }
        const facts = {cancel_requested: cancelRequested,
            ...(cancellationError ? {cancellation_error: cancellationError} : {})};
        try {
            // 使用独立读取游标取得真实输出；页面尾缓存不能代表本次工具结果。
            const result = await current.read(task.id, 0, undefined, maxChars);
            if (version === generation) {
                task.status = result.status;
                task.exit_code = result.exit_code;
                task.error = result.error || '';
                task.has_more = result.cursor > task.cursor || result.has_more;
            }
            return formatTaskResult(current.url, task, result, {...facts, ok: result.status === 'completed', interrupted: result.status !== 'completed',
                execution_state: isLocalTaskFinished(result) ? 'finished' : 'unknown'});
        } catch (error) {
            return formatTaskResult(current.url, task, {}, {...facts, ok: false, interrupted: true, execution_state: 'unknown',
                output_unavailable: true, error: error.message});
        }
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
                Object.assign(state, {connected: true, reachable: true, shell: info.shell, info, url: candidate.url, whitelistText: '', autoApprove: false, autoReview: false});
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
            const maxChars = normalizeLocalMaxChars(args.max_chars);
            const lifecycle = normalizeLocalLifecycle(args.lifecycle);
            if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
            const current = client;
            const version = generation;
            const id = crypto.randomUUID();
            const shell = args.shell || state.shell || state.info.shell;
            if (!(state.info.shells || [state.info.shell]).includes(shell)) throw new Error('Shell is unavailable on this connection');
            const task = reactive({id, shell, lifecycle, command: args.command, reason: args.reason || '', cwd: args.cwd || state.info.default_cwd, status: 'submitting', output: '', cursor: 0, has_more: false, exit_code: null, error: '', truncated: false, output_lost: false, decoding_loss: false, created_at: Date.now() / 1000});
            state.tasks.unshift(task);
            owners.set(id, owner);
            try {
                const result = await current.submit({id, command: args.command, cwd: args.cwd, shell, lifecycle}, signal);
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
                if (rejected) return formatTaskResult(current.url, task, {}, {status: 'failed', execution_state: 'not_started', error: error.message, output_unavailable: true});
                if (signal?.aborted || version !== generation) {
                    if (signal?.aborted) return finishInterruptedTask(current, task, version, maxChars);
                    current.cancel(id).catch(() => {});
                    throw error;
                }
                return formatTaskResult(current.url, task, {}, {execution_state: 'unknown', error: error.message, output_unavailable: true});
            }
            try {
                await waitForTask(task, waitSeconds, version, signal);
                // AI 的读取游标与页面轮询独立。页面裁剪日志不能推进 AI 尚未收到的内容。
                const result = await current.read(id, 0, signal, maxChars);
                if (version !== generation) throw new Error('Connection changed during execution');
                return formatTaskResult(current.url, task, result);
            } catch (error) {
                // 会话任务只结束等待；普通任务请求取消，再读取一次真实状态。
                if (signal?.aborted) return finishInterruptedTask(current, task, version, maxChars);
                if (version !== generation) throw error;
                // 读取失败不表示命令未执行，也不能把页面尾缓存当作完整结果。
                return formatTaskResult(current.url, task, {}, {execution_state: 'unknown', output_unavailable: true, error: error.message});
            }
        },
        async read(id, cursor, owner, signal, maxChars) {
            if (!client) throw new Error('No executor connection');
            if (owners.get(id)?.sessionId !== owner.sessionId) throw new Error('Task does not belong to this AI session');
            const current = client;
            const task = state.tasks.find((item) => item.id === id);
            try {
                const result = await current.read(id, cursor, signal, maxChars);
                return formatTaskResult(current.url, task, result);
            } catch (error) {
                return formatTaskResult(current.url, task, {}, {execution_state: 'unknown', output_unavailable: true, error: error.message});
            }
        },
        async cancel(id, owner) {
            if (!client) throw new Error('No executor connection');
            if (owner && owners.get(id)?.sessionId !== owner.sessionId) throw new Error('Task does not belong to this AI session');
            const current = client;
            const task = state.tasks.find((item) => item.id === id);
            try {
                const result = await current.cancel(id);
                if (task) { task.status = result.status; task.exit_code = result.exit_code; task.has_more = true; }
                return formatTaskResult(current.url, task || {id}, result, {cancel_requested: true});
            } catch (error) {
                return formatTaskResult(current.url, task || {id}, {}, {execution_state: 'unknown', output_unavailable: true, error: error.message, cancel_requested: true});
            }
        },
        list(owner) {
            if (!client) throw new Error('No executor connection');
            const endpoint = client.url;
            const tasks = state.tasks.filter((task) => owner?.sessionId && owners.get(task.id)?.sessionId === owner.sessionId)
                .map((task) => ({task_id: task.id, endpoint, lifecycle: task.lifecycle, status: task.status, command: task.command,
                    reason: task.reason, shell: task.shell, cwd: task.cwd, exit_code: task.exit_code, created_at: task.created_at}));
            return {tasks, endpoint, reachable: state.reachable, summary: tr('ai.summary.localTasks', {endpoint, reachable: tr(state.reachable ? 'ai.summary.yes' : 'ai.summary.no'), details: tasks.map((task) => `${task.task_id} (${tr(`local.lifecycle.${task.lifecycle}`)}, ${tr(`ai.summary.state.${task.status}`)})`).join(', ') || tr('ai.summary.none')})};
        },
        dispose() { disconnect(); },
    };
}
