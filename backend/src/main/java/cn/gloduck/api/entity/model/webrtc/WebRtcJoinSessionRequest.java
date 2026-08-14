package cn.gloduck.api.entity.model.webrtc;

/** 加入 WebRTC 信令会话的请求。 */
public class WebRtcJoinSessionRequest {
    /** 前端获得的不透明会话标识。 */
    public String sessionKey;

    /** 加入方使用的上层应用名称，必须与会话一致。 */
    public String application;

    /** 加入方支持的上层应用协议版本。 */
    public Integer applicationVersion;

    /** 加入方的参与者信息。 */
    public WebRtcParticipantRequest participant;
}
