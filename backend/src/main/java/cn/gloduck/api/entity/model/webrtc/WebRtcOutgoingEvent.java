package cn.gloduck.api.entity.model.webrtc;

import com.fasterxml.jackson.databind.JsonNode;

/** 客户端提交给信令服务器的出站事件。 */
public class WebRtcOutgoingEvent {
    /** 客户端生成的事件唯一标识，用于服务端幂等去重。 */
    public String eventId;

    /** 事件类型，例如 webrtc.offer 或 application.message。 */
    public String type;

    /** 接收该事件的目标参与者标识。 */
    public String targetParticipantId;

    /** 所属 WebRTC 协商批次标识；非协商事件可以为空。 */
    public String negotiationId;

    /** 事件载荷，后端不解析业务内容。 */
    public JsonNode payload;
}
