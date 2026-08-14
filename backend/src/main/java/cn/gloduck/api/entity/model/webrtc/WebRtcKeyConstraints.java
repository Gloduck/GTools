package cn.gloduck.api.entity.model.webrtc;

/** 前端生成不透明标识时需要遵守的格式约束。 */
public class WebRtcKeyConstraints {
    /** 标识允许的最小字符数。 */
    public Integer minLength;

    /** 标识允许的最大字符数。 */
    public Integer maxLength;

    /** 标识需要匹配的正则表达式。 */
    public String pattern;
}
