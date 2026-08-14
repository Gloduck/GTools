package cn.gloduck.api.entity.config;

import java.util.ArrayList;
import java.util.List;

/** WebRTC ICE 服务器配置。 */
public class WebRtcIceServerConfig {
    /** STUN 或 TURN 地址列表，例如 stun:stun.example.com:3478。 */
    public List<String> urls = new ArrayList<>();

    /** TURN 用户名；仅使用 STUN 时为空。 */
    public String username;

    /** TURN 凭证；仅使用 STUN 时为空。 */
    public String credential;
}
