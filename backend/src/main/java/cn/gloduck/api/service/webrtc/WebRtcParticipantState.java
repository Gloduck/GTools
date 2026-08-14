package cn.gloduck.api.service.webrtc;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.LinkedHashSet;
import java.util.List;

/** 服务端内存中保存的 WebRTC 参与者状态。 */
final class WebRtcParticipantState {
    /** 后端生成的参与者唯一标识。 */
    String participantId;

    /** 前端生成的客户端标识，用于定位幂等重试。 */
    String clientId;

    /** 前端 clientKey 使用服务端密钥计算后的 HMAC。 */
    byte[] clientKeyHash;

    /** 展示给其他参与者的设备名称。 */
    String displayName;

    /** 参与者角色，例如 OWNER 或 MEMBER。 */
    String role;

    /** 参与者声明的能力列表；加入会话后不再修改。 */
    List<String> capabilities;

    /** 参与者附加信息；加入会话前复制，发布后不再修改。 */
    JsonNode metadata;

    /** 参与者加入时间，Unix 毫秒时间戳。 */
    long joinedAt;

    /** 参与者最后操作时间，Unix 毫秒时间戳。 */
    long lastActivityAt;

    /** 客户端已经确认消费的最高入站事件序号。 */
    long lastAcknowledgedSequence;

    /** 分配下一条入站事件时使用的序号。 */
    long nextSequence = 1;

    /** 当前待消费事件 payload 的累计字节数。 */
    int pendingEventBytes;

    /** 尚未被客户端确认消费的入站事件队列。 */
    final Deque<WebRtcStoredEvent> pendingEvents = new ArrayDeque<>();

    /** 最近已经接收的出站事件 ID，用于请求重试时去重。 */
    final LinkedHashSet<String> acceptedEventIds = new LinkedHashSet<>();
}
