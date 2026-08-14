package cn.gloduck.api.entity.model.webrtc;

/** 单次同步中被服务端拒绝的出站事件。 */
public class WebRtcRejectedEvent {
    /** 被拒绝的客户端事件 ID。 */
    public String eventId;

    /** 机器可识别的拒绝原因代码。 */
    public String code;

    /** 面向开发者或界面的拒绝原因说明。 */
    public String message;
}
