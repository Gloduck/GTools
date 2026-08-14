package cn.gloduck.api.entity.model.webrtc;

/** 主动离开或关闭会话时提交的请求。 */
public class WebRtcCloseRequest {
    /** 客户端提供的离开或关闭原因。 */
    public String reason;
}
