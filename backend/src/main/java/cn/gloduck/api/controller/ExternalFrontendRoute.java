package cn.gloduck.api.controller;

import cn.gloduck.api.entity.config.ServerConfig;
import cn.gloduck.api.utils.FileUtils;
import io.quarkus.vertx.http.runtime.RouteConstants;
import io.vertx.ext.web.Router;
import io.vertx.ext.web.RoutingContext;
import io.vertx.ext.web.handler.FileSystemAccess;
import io.vertx.ext.web.handler.StaticHandler;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.inject.Inject;

import java.nio.file.Path;

@ApplicationScoped
public class ExternalFrontendRoute {
    private static final String INTERNAL_FRONTEND_ROOT = "META-INF/resources/";

    @Inject
    ServerConfig serverConfig;

    void register(@Observes Router router) {
        if (serverConfig.frontendPath == null || serverConfig.frontendPath.isBlank()) {
            return;
        }

        Path frontendDir = Path.of(serverConfig.frontendPath);
        if (!frontendDir.isAbsolute()) {
            frontendDir = FileUtils.applicationDirectory(ExternalFrontendRoute.class).resolve(frontendDir);
        }
        frontendDir = frontendDir.toAbsolutePath().normalize();

        StaticHandler handler = StaticHandler.create(FileSystemAccess.ROOT, frontendDir.toString())
                .setDirectoryListing(false)
                .setIncludeHidden(false);

        router.get("/*")
                .order(RouteConstants.ROUTE_ORDER_BEFORE_DEFAULT)
                .handler(context -> handleFallback(context, handler));
        router.head("/*")
                .order(RouteConstants.ROUTE_ORDER_BEFORE_DEFAULT)
                .handler(context -> handleFallback(context, handler));
    }

    private void handleFallback(RoutingContext context, StaticHandler handler) {
        String path = context.normalizedPath();
        if (path.equals("/api") || path.startsWith("/api/")) {
            context.next();
            return;
        }
        if (hasInternalResource(path)) {
            context.next();
            return;
        }
        handler.handle(context);
    }

    private boolean hasInternalResource(String requestPath) {
        String resourcePath = requestPath.startsWith("/") ? requestPath.substring(1) : requestPath;
        if (resourcePath.isEmpty() || resourcePath.endsWith("/")) {
            resourcePath += "index.html";
        }
        return ExternalFrontendRoute.class.getClassLoader()
                .getResource(INTERNAL_FRONTEND_ROOT + resourcePath) != null;
    }
}
