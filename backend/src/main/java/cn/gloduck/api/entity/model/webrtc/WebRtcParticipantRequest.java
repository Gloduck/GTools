package cn.gloduck.api.entity.model.webrtc;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.List;

/** 创建或加入会话时提交的参与者信息。 */
public class WebRtcParticipantRequest {
    /** 前端生成的客户端标识，用于定位同一次幂等连接请求。 */
    public String clientId;

    /** 前端生成的高熵客户端密钥，用于证明幂等重试来自同一客户端。 */
    public String clientKey;

    /** 展示给其他参与者的设备名称。 */
    public String displayName;

    /** 客户端支持的能力列表，例如 file-transfer-v1。 */
    public List<String> capabilities;

    /** 客户端附加信息，后端仅校验大小并原样转发。 */
    public JsonNode metadata;
}
