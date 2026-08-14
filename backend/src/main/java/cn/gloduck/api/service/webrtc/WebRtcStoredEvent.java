package cn.gloduck.api.service.webrtc;

import com.fasterxml.jackson.databind.JsonNode;

/** 服务端参与者队列中保存的信令事件。 */
final class WebRtcStoredEvent {
    /** 针对目标参与者分配的递增序号。 */
    long sequence;

    /** 事件唯一标识。 */
    String eventId;

    /** 事件类型。 */
    String type;

    /** 事件发送者的参与者标识。 */
    String sourceParticipantId;

    /** 事件接收者的参与者标识。 */
    String targetParticipantId;

    /** 所属 WebRTC 协商批次标识。 */
    String negotiationId;

    /** 事件载荷；入队前已与请求数据隔离，入队后不再修改。 */
    JsonNode payload;

    /** payload 序列化后的字节数，用于内存配额统计。 */
    int payloadBytes;

    /** 服务端接收或生成事件的时间，Unix 毫秒时间戳。 */
    long createdAt;
}
