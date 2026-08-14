import {CommonUtils} from '../common-utils.js';

const CONTROL_CHANNEL = 'file-transfer-control';
const DATA_CHANNEL = 'file-transfer-data';
const ICE_GATHERING_TIMEOUT_MS = 10_000;

export class WebRtcPeerConnection {
    #iceServers;
    #initiator;
    #sendSignal;
    #callbacks;
    #peer = null;
    #connection = null;
    #controlChannel = null;
    #dataChannel = null;
    #negotiationId = null;
    #negotiating = false;
    #channelsReported = false;
    #generation = 0;

    constructor({iceServers = [], initiator = false, sendSignal, callbacks = {}}) {
        this.#iceServers = iceServers;
        this.#initiator = initiator;
        this.#sendSignal = sendSignal;
        this.#callbacks = {
            onConnectionState: callbacks.onConnectionState || (() => {}),
            onChannelState: callbacks.onChannelState || (() => {}),
            onChannelsReady: callbacks.onChannelsReady || (() => {}),
            onError: callbacks.onError || (() => {})
        };
    }

    get peer() {
        return this.#peer;
    }

    get connected() {
        return this.#controlChannel?.readyState === 'open' && this.#dataChannel?.readyState === 'open';
    }

    async setPeer(peer) {
        const nextPeerId = peer?.participantId || null;
        const currentPeerId = this.#peer?.participantId || null;
        if (currentPeerId === nextPeerId) {
            this.#peer = peer;
            return;
        }

        this.close();
        this.#peer = peer || null;
        if (!this.#peer) {
            this.#callbacks.onConnectionState('waiting');
            return;
        }
        this.#callbacks.onConnectionState('connecting');
        this.#callbacks.onChannelState('connecting');
        if (this.#initiator) await this.#createOffer();
    }

    async handleSignal(event) {
        if (!event?.type?.startsWith('webrtc.')) return;
        if (!this.#peer || event.sourceParticipantId !== this.#peer.participantId) return;

        try {
            if (event.type === 'webrtc.offer') {
                await this.#acceptOffer(event);
            } else if (event.type === 'webrtc.answer') {
                await this.#acceptAnswer(event);
            } else if (event.type === 'webrtc.ice-candidate') {
                await this.#connection?.addIceCandidate(event.payload);
            } else if (event.type === 'webrtc.restart-request' && this.#initiator) {
                await this.#createOffer({iceRestart: true, replaceConnection: false});
            } else if (event.type === 'webrtc.close') {
                this.close();
            }
        } catch (error) {
            this.#callbacks.onError(error);
            this.#callbacks.onConnectionState('failed');
        }
    }

    async reconnect() {
        if (!this.#peer || this.#negotiating) return;
        const peer = this.#peer;
        this.close();
        this.#peer = peer;
        this.#callbacks.onConnectionState('connecting');
        this.#callbacks.onChannelState('connecting');
        if (this.#initiator) {
            await this.#createOffer();
        } else {
            this.#sendSignal({
                type: 'webrtc.restart-request',
                targetParticipantId: peer.participantId,
                negotiationId: CommonUtils.createRandomUuid(),
                payload: null
            });
        }
    }

    close() {
        this.#generation += 1;
        this.#negotiating = false;
        this.#negotiationId = null;
        this.#channelsReported = false;

        for (const channel of [this.#controlChannel, this.#dataChannel]) {
            if (!channel) continue;
            channel.onopen = null;
            channel.onclose = null;
            channel.onerror = null;
            channel.onmessage = null;
            try {
                channel.close();
            } catch {
            }
        }
        this.#controlChannel = null;
        this.#dataChannel = null;

        if (this.#connection) {
            this.#connection.onconnectionstatechange = null;
            this.#connection.oniceconnectionstatechange = null;
            this.#connection.ondatachannel = null;
            try {
                this.#connection.close();
            } catch {
            }
        }
        this.#connection = null;
        this.#callbacks.onChannelState('closed');
    }

    async #createOffer({iceRestart = false, replaceConnection = true} = {}) {
        if (!this.#initiator || !this.#peer || this.#negotiating) return;
        if (this.#connection && replaceConnection) return;

        this.#negotiating = true;
        this.#callbacks.onConnectionState('negotiating');
        const generation = this.#generation;
        try {
            const connection = this.#connection || this.#createConnection();
            if (!this.#controlChannel || !this.#dataChannel) {
                this.#registerChannel(connection.createDataChannel(CONTROL_CHANNEL, {ordered: true}));
                this.#registerChannel(connection.createDataChannel(DATA_CHANNEL, {ordered: true}));
            }
            this.#negotiationId = CommonUtils.createRandomUuid();
            const offer = await connection.createOffer({iceRestart});
            await connection.setLocalDescription(offer);
            await waitForIceGathering(connection);
            if (generation !== this.#generation || !this.#peer) return;
            this.#sendSignal({
                type: 'webrtc.offer',
                targetParticipantId: this.#peer.participantId,
                negotiationId: this.#negotiationId,
                payload: connection.localDescription?.toJSON?.() || connection.localDescription
            });
        } finally {
            this.#negotiating = false;
        }
    }

    async #acceptOffer(event) {
        if (this.#initiator) return;
        if (event.negotiationId === this.#negotiationId && this.#connection?.remoteDescription) return;

        this.close();
        this.#peer = {participantId: event.sourceParticipantId};
        this.#negotiationId = event.negotiationId;
        this.#callbacks.onConnectionState('negotiating');
        const generation = this.#generation;
        const connection = this.#createConnection();
        await connection.setRemoteDescription(event.payload);
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        await waitForIceGathering(connection);
        if (generation !== this.#generation || !this.#peer) return;
        this.#sendSignal({
            type: 'webrtc.answer',
            targetParticipantId: this.#peer.participantId,
            negotiationId: this.#negotiationId,
            payload: connection.localDescription?.toJSON?.() || connection.localDescription
        });
    }

    async #acceptAnswer(event) {
        if (!this.#initiator || !this.#connection || event.negotiationId !== this.#negotiationId) return;
        if (this.#connection.signalingState !== 'have-local-offer') return;
        await this.#connection.setRemoteDescription(event.payload);
    }

    #createConnection() {
        const connection = new RTCPeerConnection({iceServers: this.#iceServers});
        this.#connection = connection;
        this.#callbacks.onConnectionState('connecting');

        connection.onconnectionstatechange = () => {
            const state = connection.connectionState;
            this.#callbacks.onConnectionState(state);
            if (state === 'failed') this.#callbacks.onError(new Error('WEBRTC_CONNECTION_FAILED'));
        };
        connection.oniceconnectionstatechange = () => {
            if (connection.iceConnectionState === 'failed') {
                this.#callbacks.onConnectionState('failed');
            }
        };
        connection.ondatachannel = (event) => this.#registerChannel(event.channel);
        return connection;
    }

    #registerChannel(channel) {
        if (channel.label === CONTROL_CHANNEL) this.#controlChannel = channel;
        else if (channel.label === DATA_CHANNEL) this.#dataChannel = channel;
        else {
            channel.close();
            return;
        }

        channel.binaryType = 'arraybuffer';
        channel.onopen = () => this.#reportChannelState();
        channel.onclose = () => this.#reportChannelState();
        channel.onerror = () => this.#reportChannelState();
        this.#reportChannelState();
    }

    #reportChannelState() {
        const states = [this.#controlChannel?.readyState, this.#dataChannel?.readyState].filter(Boolean);
        let state = 'connecting';
        if (states.includes('closing') || states.includes('closed')) state = 'closed';
        if (this.connected) state = 'connected';
        this.#callbacks.onChannelState(state);

        if (this.connected && !this.#channelsReported) {
            this.#channelsReported = true;
            this.#callbacks.onChannelsReady({
                controlChannel: this.#controlChannel,
                dataChannel: this.#dataChannel,
                maxMessageSize: this.#connection?.sctp?.maxMessageSize
            });
        }
    }
}

function waitForIceGathering(connection) {
    if (connection.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
        let timeout;
        const finish = () => {
            clearTimeout(timeout);
            connection.removeEventListener('icegatheringstatechange', handleChange);
            resolve();
        };
        const handleChange = () => {
            if (connection.iceGatheringState === 'complete') finish();
        };
        connection.addEventListener('icegatheringstatechange', handleChange);
        timeout = setTimeout(finish, ICE_GATHERING_TIMEOUT_MS);
    });
}
