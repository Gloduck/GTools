package cn.gloduck.api.entity.model.webrtc;

/** 参与者主动离开会话后的响应。 */
public class WebRtcLeaveResponse {
    /** 已离开会话的参与者标识。 */
    public String participantId;

    /** 服务端确认离开的时间，Unix 毫秒时间戳。 */
    public Long leftAt;

    /** 本次离开是否同时导致整个会话关闭。 */
    public Boolean sessionClosed;
}
