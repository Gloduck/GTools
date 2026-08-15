package cn.gloduck.api.entity.config;

import java.util.ArrayList;
import java.util.List;

public class ServerConfig {
    public Integer port = 8080;

    public String frontendPath = "frontend";

    public List<StaticRouteConfig> staticRoutes = new ArrayList<>(List.of(
            new StaticRouteConfig("/static/*", "static")
    ));

    public LogConfig log;
}
