import {CommonUtils} from '../common-utils.js';

const API_BASE = '/api/webrtc/v1';
const FATAL_SYNC_STATUSES = new Set([401, 403, 404, 410]);
const FATAL_SYNC_CODES = new Set([
    'WEBRTC_PARTICIPANT_TOKEN_INVALID',
    'WEBRTC_PARTICIPANT_NOT_IN_SESSION',
    'WEBRTC_SESSION_NOT_FOUND',
    'WEBRTC_SESSION_EXPIRED',
    'WEBRTC_SESSION_CLOSED'
]);
const POLL_INTERVAL_MS = 5_000;

export class WebRtcApiError extends Error {
    constructor(message, {status = 0, code = '', data = null} = {}) {
        super(message || code || 'WEBRTC_REQUEST_FAILED');
        this.name = 'WebRtcApiError';
        this.status = status;
        this.code = code || message || '';
        this.data = data;
    }
}

export async function loadWebRtcConfig({signal} = {}) {
    return requestJson(`${API_BASE}/config`, {signal});
}

export class WebRtcSignalingClient {
    #session = null;
    #participantToken = '';
    #ackSequence = 0;
    #pendingEvents = new Map();
    #active = false;
    #syncRequested = false;
    #syncPromise = null;
    #pollTimer = null;
    #failureCount = 0;
    #callbacks;

    constructor(callbacks = {}) {
        this.#callbacks = {
            onEvent: callbacks.onEvent || (() => {}),
            onSnapshot: callbacks.onSnapshot || (() => {}),
            onRejectedEvent: callbacks.onRejectedEvent || (() => {}),
            onError: callbacks.onError || (() => {})
        };
    }

    get session() {
        return this.#session;
    }

    get active() {
        return this.#active;
    }

    async createSession(request) {
        const session = await requestJson(`${API_BASE}/sessions`, {
            method: 'POST',
            body: request
        });
        this.#setSession(session);
        return session;
    }

    async joinSession(request) {
        const session = await requestJson(`${API_BASE}/sessions/join`, {
            method: 'POST',
            body: request
        });
        this.#setSession(session);
        return session;
    }

    start() {
        if (!this.#session || this.#active) return;
        this.#active = true;
        this.requestSync();
    }

    stop() {
        this.#active = false;
        this.#syncRequested = false;
        if (this.#pollTimer) {
            clearTimeout(this.#pollTimer);
            this.#pollTimer = null;
        }
    }

    sendEvent({type, targetParticipantId, negotiationId = null, payload = null}) {
        if (!this.#session) throw new Error('WebRTC signaling session is not initialized');
        const event = {
            eventId: CommonUtils.createRandomUuid(),
            type,
            targetParticipantId,
            negotiationId,
            payload
        };
        this.#pendingEvents.set(event.eventId, event);
        this.requestSync();
        return event.eventId;
    }

    requestSync() {
        if (!this.#active || !this.#session) return Promise.resolve();
        this.#syncRequested = true;
        if (this.#pollTimer) {
            clearTimeout(this.#pollTimer);
            this.#pollTimer = null;
        }
        if (this.#syncPromise) return this.#syncPromise;

        this.#syncPromise = this.#runSyncLoop().finally(() => {
            this.#syncPromise = null;
            if (this.#active) this.#scheduleNextPoll();
        });
        return this.#syncPromise;
    }

    async closeSession(reason = 'CLIENT_CLOSED', {keepalive = false} = {}) {
        if (!this.#session) return null;
        this.stop();
        return requestJson(`${API_BASE}/sessions/${encodeURIComponent(this.#session.sessionId)}`, {
            method: 'DELETE',
            token: this.#participantToken,
            body: {reason},
            keepalive
        });
    }

    async leaveSession(reason = 'CLIENT_LEAVE', {keepalive = false} = {}) {
        if (!this.#session) return null;
        this.stop();
        return requestJson(`${API_BASE}/sessions/${encodeURIComponent(this.#session.sessionId)}/participants/me`, {
            method: 'DELETE',
            token: this.#participantToken,
            body: {reason},
            keepalive
        });
    }

    #setSession(session) {
        this.stop();
        this.#session = session;
        this.#participantToken = session.participantToken;
        this.#ackSequence = 0;
        this.#pendingEvents.clear();
        this.#failureCount = 0;
    }

    async #runSyncLoop() {
        while (this.#active && this.#syncRequested) {
            this.#syncRequested = false;
            try {
                const snapshot = await requestJson(
                    `${API_BASE}/sessions/${encodeURIComponent(this.#session.sessionId)}/sync`,
                    {
                        method: 'POST',
                        token: this.#participantToken,
                        body: {
                            ackSequence: this.#ackSequence,
                            events: [...this.#pendingEvents.values()]
                        }
                    }
                );

                for (const eventId of snapshot.acceptedEventIds || []) {
                    this.#pendingEvents.delete(eventId);
                }
                for (const rejected of snapshot.rejectedEvents || []) {
                    this.#pendingEvents.delete(rejected.eventId);
                    await this.#callbacks.onRejectedEvent(rejected);
                }

                const events = [...(snapshot.events || [])].sort((left, right) => left.sequence - right.sequence);
                for (const event of events) {
                    if (event.sequence <= this.#ackSequence) continue;
                    await this.#callbacks.onEvent(event);
                    this.#ackSequence = event.sequence;
                }

                this.#failureCount = 0;
                await this.#callbacks.onSnapshot(snapshot);
            } catch (error) {
                this.#failureCount += 1;
                await this.#callbacks.onError(error);
                if (error instanceof WebRtcApiError
                    && (FATAL_SYNC_STATUSES.has(error.status) || FATAL_SYNC_CODES.has(error.code))) {
                    this.stop();
                }
                break;
            }
        }
    }

    #scheduleNextPoll() {
        if (this.#pollTimer || !this.#active) return;
        const backoff = Math.min(3, Math.max(1, this.#failureCount + 1));
        this.#pollTimer = setTimeout(() => {
            this.#pollTimer = null;
            this.requestSync();
        }, POLL_INTERVAL_MS * backoff);
    }
}

async function requestJson(url, {
    method = 'GET',
    token = '',
    body,
    signal,
    keepalive = false
} = {}) {
    const headers = {Accept: 'application/json'};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;

    let response;
    try {
        response = await fetch(url, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            signal,
            keepalive
        });
    } catch (error) {
        if (error?.name === 'AbortError') throw error;
        throw new WebRtcApiError(error?.message || 'NETWORK_ERROR');
    }

    let result = null;
    try {
        result = await response.json();
    } catch {
        if (!response.ok) {
            throw new WebRtcApiError(`HTTP_${response.status}`, {status: response.status});
        }
        throw new WebRtcApiError('INVALID_SERVER_RESPONSE', {status: response.status});
    }

    if (!response.ok || result?.code !== 200) {
        throw new WebRtcApiError(result?.msg || `HTTP_${response.status}`, {
            status: response.status,
            code: result?.msg || '',
            data: result?.data
        });
    }
    return result.data;
}
