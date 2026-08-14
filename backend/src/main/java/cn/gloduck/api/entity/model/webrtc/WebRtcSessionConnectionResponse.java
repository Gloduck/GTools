package cn.gloduck.api.entity.model.webrtc;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.ArrayList;
import java.util.List;

/** 创建或加入会话成功后返回的连接信息。 */
public class WebRtcSessionConnectionResponse {
    /** 后端生成的会话唯一标识，后续接口通过它定位会话。 */
    public String sessionId;

    /** 当前客户端在该会话中的参与者标识。 */
    public String participantId;

    /** 当前参与者后续调用受保护接口时使用的 Bearer Token。 */
    public String participantToken;

    /** 当前参与者角色，例如 OWNER 或 MEMBER。 */
    public String role;

    /** 会话所属的上层应用名称。 */
    public String application;

    /** 会话使用的上层应用协议版本。 */
    public Integer applicationVersion;

    /** 会话允许的最大参与者数量。 */
    public Integer maxParticipants;

    /** 会话创建时间，Unix 毫秒时间戳。 */
    public Long createdAt;

    /** 会话最后活动时间，Unix 毫秒时间戳。 */
    public Long lastActivityAt;

    /** 会话创建时保存的附加信息。 */
    public JsonNode metadata;

    /** 会话中除当前客户端以外的其他参与者。 */
    public List<WebRtcParticipantInfo> participants = new ArrayList<>();
}
