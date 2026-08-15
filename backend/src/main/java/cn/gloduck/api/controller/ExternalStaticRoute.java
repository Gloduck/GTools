package cn.gloduck.api.controller;

import cn.gloduck.api.entity.config.ServerConfig;
import cn.gloduck.api.entity.config.StaticRouteConfig;
import cn.gloduck.api.utils.FileUtils;
import io.vertx.ext.web.Router;
import io.vertx.ext.web.handler.FileSystemAccess;
import io.vertx.ext.web.handler.StaticHandler;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;

import java.nio.file.Path;

@ApplicationScoped
public class ExternalStaticRoute {
    private final ServerConfig serverConfig;

    public ExternalStaticRoute(ServerConfig serverConfig) {
        this.serverConfig = serverConfig;
    }

    void register(@Observes Router router) {
        if (serverConfig.staticRoutes == null) {
            return;
        }

        Path applicationDir = FileUtils.applicationDirectory(ExternalStaticRoute.class);
        for (StaticRouteConfig config : serverConfig.staticRoutes) {
            registerRoute(router, applicationDir, config);
        }
    }

    private void registerRoute(Router router, Path applicationDir, StaticRouteConfig config) {
        if (config == null || config.route == null || config.route.isBlank()
                || config.path == null || config.path.isBlank()) {
            throw new IllegalArgumentException("staticRoutes entries require non-empty route and path values");
        }
        if (!config.route.startsWith("/") || !config.route.endsWith("/*")) {
            throw new IllegalArgumentException("static route must start with '/' and end with '/*': " + config.route);
        }

        Path staticDir = Path.of(config.path);
        if (!staticDir.isAbsolute()) {
            staticDir = applicationDir.resolve(staticDir);
        }
        staticDir = staticDir.toAbsolutePath().normalize();

        StaticHandler handler = StaticHandler.create(FileSystemAccess.ROOT, staticDir.toString())
                .setDirectoryListing(false)
                .setIncludeHidden(false);

        router.get(config.route).handler(handler);
        router.head(config.route).handler(handler);
    }
}
