package cn.gloduck.api.entity.model.webrtc;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.ArrayList;
import java.util.List;

/** 查询会话时返回的完整会话快照。 */
public class WebRtcSessionInfo {
    /** 会话唯一标识。 */
    public String sessionId;

    /** 会话所属的上层应用名称。 */
    public String application;

    /** 会话使用的上层应用协议版本。 */
    public Integer applicationVersion;

    /** 会话状态，例如 WAITING、ACTIVE 或 CLOSED。 */
    public String state;

    /** 会话允许的最大参与者数量。 */
    public Integer maxParticipants;

    /** 会话创建时间，Unix 毫秒时间戳。 */
    public Long createdAt;

    /** 会话最后活动时间，Unix 毫秒时间戳。 */
    public Long lastActivityAt;

    /** 会话附加信息。 */
    public JsonNode metadata;

    /** 当前请求者自身的参与者信息。 */
    public WebRtcParticipantInfo self;

    /** 除当前请求者以外的其他参与者。 */
    public List<WebRtcParticipantInfo> participants = new ArrayList<>();
}
