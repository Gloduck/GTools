package cn.gloduck.api.entity.model.webrtc;

import com.fasterxml.jackson.databind.JsonNode;

/** 服务端投递给指定参与者的入站信令事件。 */
public class WebRtcSignalEvent {
    /** 针对接收者单调递增的事件序号。 */
    public Long sequence;

    /** 事件唯一标识。 */
    public String eventId;

    /** 事件类型。 */
    public String type;

    /** 事件发送者的参与者标识；服务端事件可以为空。 */
    public String sourceParticipantId;

    /** 事件接收者的参与者标识。 */
    public String targetParticipantId;

    /** 所属 WebRTC 协商批次标识。 */
    public String negotiationId;

    /** 服务端接收或生成事件的时间，Unix 毫秒时间戳。 */
    public Long createdAt;

    /** 事件载荷。 */
    public JsonNode payload;
}
