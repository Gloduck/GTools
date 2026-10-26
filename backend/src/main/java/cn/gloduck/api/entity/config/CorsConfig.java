package cn.gloduck.api.entity.config;

import java.util.ArrayList;
import java.util.List;

/** 跨域访问配置。 */
public class CorsConfig {
    /** 是否启用全局 CORS。 */
    public Boolean enabled = false;

    /** 允许访问的来源，例如 https://example.com；"*" 表示允许任意来源。 */
    public List<String> allowedOrigins = new ArrayList<>();

    /** 预检结果缓存秒数。 */
    public Long maxAgeSeconds = 86400L;
}
