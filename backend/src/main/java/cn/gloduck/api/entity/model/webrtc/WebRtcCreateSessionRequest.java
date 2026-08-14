package cn.gloduck.api.entity.model.webrtc;

import com.fasterxml.jackson.databind.JsonNode;

/** 创建 WebRTC 信令会话的请求。 */
public class WebRtcCreateSessionRequest {
    /** 前端生成的不透明会话标识，可由连接码、Token 等形式产生。 */
    public String sessionKey;

    /** 使用该信令会话的上层应用名称。 */
    public String application;

    /** 上层应用协议版本。 */
    public Integer applicationVersion;

    /** 当前会话允许的最大参与者数量。 */
    public Integer maxParticipants;

    /** 会话创建者的参与者信息。 */
    public WebRtcParticipantRequest participant;

    /** 会话附加信息，后端仅校验大小并原样保存。 */
    public JsonNode metadata;
}
