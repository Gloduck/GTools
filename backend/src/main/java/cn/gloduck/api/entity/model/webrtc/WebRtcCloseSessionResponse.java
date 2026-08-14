package cn.gloduck.api.entity.model.webrtc;

/** 创建者主动关闭会话后的响应。 */
public class WebRtcCloseSessionResponse {
    /** 已关闭的会话标识。 */
    public String sessionId;

    /** 服务端关闭会话的时间，Unix 毫秒时间戳。 */
    public Long closedAt;
}
