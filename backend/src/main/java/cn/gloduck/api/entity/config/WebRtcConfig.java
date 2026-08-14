package cn.gloduck.api.entity.config;

import java.util.ArrayList;
import java.util.List;

public class WebRtcConfig {
    /** 普通参与者多久未操作后被判定离线，单位为毫秒；房主由会话空闲超时控制。 */
    public Long participantIdleTimeoutMs = 30_000L;

    /** 无参与者会话的保留时间，单位为毫秒。 */
    public Long emptySessionTimeoutMs = 30_000L;

    /** 会话多久没有任何操作后自动关闭，单位为毫秒。 */
    public Long sessionIdleTimeoutMs = 120_000L;

    /** JDK 定时清理任务的执行间隔，单位为毫秒。 */
    public Long cleanupIntervalMs = 10_000L;

    /** 已关闭会话为投递关闭事件而继续保留的时间，单位为毫秒。 */
    public Long closedSessionRetentionMs = 30_000L;

    /** 当前进程允许同时保存的最大会话数量。 */
    public Integer maxSessions = 100;

    /** 单个会话允许加入的最大参与者数量。 */
    public Integer maxParticipants = 10;

    /** 单个参与者允许积压的最大信令事件数量。 */
    public Integer maxPendingEventsPerParticipant = 128;

    /** 单个参与者允许积压的最大信令载荷字节数。 */
    public Integer maxPendingEventBytesPerParticipant = 1_048_576;

    /** 单次同步请求允许提交的最大出站事件数量。 */
    public Integer maxOutgoingEventsPerSync = 32;

    /** 单条信令事件 payload 序列化后的最大字节数。 */
    public Integer maxEventPayloadBytes = 262_144;

    /** 会话或参与者 metadata 序列化后的最大字节数。 */
    public Integer maxMetadataBytes = 16_384;

    /** 浏览器创建 RTCPeerConnection 时使用的 STUN/TURN 服务器列表。 */
    public List<WebRtcIceServerConfig> iceServers = defaultIceServers();

    /** 创建未显式配置 ICE 服务器时使用的公共 STUN 配置。 */
    public static List<WebRtcIceServerConfig> defaultIceServers() {
        List<WebRtcIceServerConfig> servers = new ArrayList<>();
        WebRtcIceServerConfig server = new WebRtcIceServerConfig();
        server.urls.add("stun:stun.miwifi.com:3478");
        server.urls.add("stun:stun.chat.bilibili.com:3478");
        server.urls.add("stun:stun.cloudflare.com:3478");
        server.urls.add("stun:stun.l.google.com:19302");
        servers.add(server);
        return servers;
    }
}
