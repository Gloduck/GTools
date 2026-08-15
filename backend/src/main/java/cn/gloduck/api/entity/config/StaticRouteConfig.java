package cn.gloduck.api.entity.config;

public class StaticRouteConfig {
    public String route;

    public String path;

    public StaticRouteConfig() {
    }

    public StaticRouteConfig(String route, String path) {
        this.route = route;
        this.path = path;
    }
}
