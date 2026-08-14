package cn.gloduck.api.service.webrtc;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.LinkedHashMap;
import java.util.Map;

/** 服务端内存中保存的 WebRTC 信令会话状态。 */
final class WebRtcSessionState {
    /** 后端生成的会话唯一标识。 */
    String sessionId;

    /** sessionKey 使用进程内密钥计算后的 HMAC，用于会话索引。 */
    String sessionKeyHash;

    /** 会话所属的上层应用名称。 */
    String application;

    /** 上层应用协议版本。 */
    Integer applicationVersion;

    /** 会话允许的最大参与者数量。 */
    int maxParticipants;

    /** 会话附加信息；创建时复制，发布后不再修改。 */
    JsonNode metadata;

    /** 会话创建时间，Unix 毫秒时间戳。 */
    long createdAt;

    /** 会话最后活动时间，Unix 毫秒时间戳。 */
    long lastActivityAt;

    /** 会话创建者的参与者标识。 */
    String ownerParticipantId;

    /** 当前会话状态。 */
    String state;

    /** 会话是否已经进入关闭状态。 */
    boolean closed;

    /** 会话关闭时间，Unix 毫秒时间戳。 */
    long closedAt;

    /** 会话关闭原因。 */
    String closedReason;

    /** 主动关闭会话的参与者标识；系统关闭时为空。 */
    String closedBy;

    /** 会话是否已经从索引中彻底清理。 */
    boolean purged;

    /** 按 participantId 保存的当前参与者。 */
    final Map<String, WebRtcParticipantState> participants = new LinkedHashMap<>();

    /** 按前端 clientId 保存的参与者，用于幂等连接重试。 */
    final Map<String, WebRtcParticipantState> participantsByClientId = new LinkedHashMap<>();
}
