package cn.gloduck.api.entity.model.webrtc;

import cn.gloduck.api.entity.config.WebRtcIceServerConfig;

import java.util.ArrayList;
import java.util.List;

/** 前端初始化 WebRTC 信令客户端所需的服务器配置。 */
public class WebRtcConfigResponse {
    /** 当前后端支持的信令协议版本。 */
    public Integer protocolVersion;

    /** 普通参与者无操作超时时间，单位为毫秒。 */
    public Long participantIdleTimeoutMs;

    /** 会话无操作超时时间，单位为毫秒。 */
    public Long sessionIdleTimeoutMs;

    /** 当前进程允许保存的最大会话数量。 */
    public Integer maxSessions;

    /** 单个会话允许的最大参与者数量。 */
    public Integer maxParticipants;

    /** 单次同步允许提交的最大出站事件数量。 */
    public Integer maxOutgoingEventsPerSync;

    /** 单个参与者允许积压的最大事件数量。 */
    public Integer maxPendingEventsPerParticipant;

    /** 单个参与者允许积压的最大事件载荷字节数。 */
    public Integer maxPendingEventBytesPerParticipant;

    /** 单条事件 payload 的最大字节数。 */
    public Integer maxEventPayloadBytes;

    /** metadata 的最大字节数。 */
    public Integer maxMetadataBytes;

    /** sessionKey 的格式约束。 */
    public WebRtcKeyConstraints sessionKeyConstraints;

    /** 参与者 clientKey 的格式约束。 */
    public WebRtcKeyConstraints participantKeyConstraints;

    /** 浏览器可直接传给 RTCPeerConnection 的 ICE 服务器列表。 */
    public List<WebRtcIceServerConfig> iceServers = new ArrayList<>();
}
