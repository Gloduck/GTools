package cn.gloduck.api.entity.model.webrtc;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.ArrayList;
import java.util.List;

/** 返回给前端的参与者公开信息。 */
public class WebRtcParticipantInfo {
    /** 后端生成的参与者唯一标识。 */
    public String participantId;

    /** 参与者设备的展示名称。 */
    public String displayName;

    /** 参与者在会话中的角色。 */
    public String role;

    /** 参与者声明的能力列表。 */
    public List<String> capabilities = new ArrayList<>();

    /** 参与者附加信息。 */
    public JsonNode metadata;

    /** 参与者加入会话的时间，Unix 毫秒时间戳。 */
    public Long joinedAt;

    /** 参与者最后操作时间，Unix 毫秒时间戳。 */
    public Long lastActivityAt;
}
