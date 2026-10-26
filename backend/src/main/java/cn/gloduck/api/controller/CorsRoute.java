package cn.gloduck.api.controller;

import cn.gloduck.api.entity.config.CorsConfig;
import io.vertx.core.MultiMap;
import io.vertx.core.http.HttpMethod;
import io.vertx.core.http.HttpServerResponse;
import io.vertx.ext.web.Router;
import io.vertx.ext.web.RoutingContext;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.inject.Inject;

import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;

@ApplicationScoped
public class CorsRoute {
    private static final String ALLOWED_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD";

    @Inject
    CorsConfig corsConfig;

    /** 在业务路由前处理跨域请求，便于前端连接其他部署的后端。 */
    void register(@Observes Router router) {
        if (!Boolean.TRUE.equals(corsConfig.enabled)) {
            return;
        }
        Set<String> origins = corsConfig.allowedOrigins == null ? Set.of() : corsConfig.allowedOrigins.stream()
                .filter(origin -> origin != null && !origin.isBlank())
                .map(CorsRoute::normalizeOrigin)
                .collect(Collectors.toUnmodifiableSet());
        if (origins.isEmpty()) {
            return;
        }
        router.route().order(Integer.MIN_VALUE).handler(context -> handle(context, origins));
    }

    private void handle(RoutingContext context, Set<String> origins) {
        String origin = context.request().getHeader("Origin");
        if (origin == null || !(origins.contains("*") || origins.contains(normalizeOrigin(origin)))) {
            context.next();
            return;
        }

        HttpServerResponse response = context.response();
        String requestMethod = context.request().getHeader("Access-Control-Request-Method");
        if (context.request().method() == HttpMethod.OPTIONS && requestMethod != null) {
            applyOriginHeaders(response.headers(), origin);
            response.putHeader("Access-Control-Allow-Methods", ALLOWED_METHODS);
            String requestHeaders = context.request().getHeader("Access-Control-Request-Headers");
            if (requestHeaders != null && !requestHeaders.isBlank()) {
                response.putHeader("Access-Control-Allow-Headers", requestHeaders);
            }
            if ("true".equalsIgnoreCase(context.request().getHeader("Access-Control-Request-Private-Network"))) {
                response.putHeader("Access-Control-Allow-Private-Network", "true");
            }
            long maxAge = corsConfig.maxAgeSeconds == null ? 86400L : Math.max(0L, corsConfig.maxAgeSeconds);
            response.putHeader("Access-Control-Max-Age", Long.toString(maxAge));
            response.setStatusCode(204).end();
            return;
        }

        // 请求代理可能已按 X-Proxy-Cors 写入 CORS 头，这里只补齐缺失项，避免重复头导致浏览器拒绝。
        context.addHeadersEndHandler(ignored -> {
            MultiMap headers = response.headers();
            if (!headers.contains("Access-Control-Allow-Origin")) {
                applyOriginHeaders(headers, origin);
            }
            if (!headers.contains("Access-Control-Expose-Headers")) {
                headers.set("Access-Control-Expose-Headers", "*");
            }
        });
        context.next();
    }

    private void applyOriginHeaders(MultiMap headers, String origin) {
        headers.set("Access-Control-Allow-Origin", origin);
        headers.add("Vary", "Origin");
    }

    private static String normalizeOrigin(String origin) {
        String value = origin.trim();
        while (value.endsWith("/")) {
            value = value.substring(0, value.length() - 1);
        }
        return value.toLowerCase(Locale.ROOT);
    }
}
