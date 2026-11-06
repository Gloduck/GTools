package dev.executor.core;

import java.io.File;
import java.io.IOException;
import java.net.InetAddress;
import java.net.URI;
import java.util.HashMap;
import java.util.Map;

/** 仅接受显式地址，不通过监听参数触发 DNS 查询或自动提升权限。 */
public final class ExecutorConfig {
    public final String origin;
    public final String listenAddress;
    public final int port;
    public final File directory;
    public final String publicUrl;

    public ExecutorConfig(String origin, String listenAddress, int port, File directory, String publicUrl) throws IOException {
        this.origin = validateUrl(origin, false);
        if (port < 0 || port > 65535) throw new IllegalArgumentException("Invalid port");
        if (!listenAddress.matches("[0-9a-fA-F:.]+")) throw new IllegalArgumentException("Listen address must be an IP address");
        if (!listenAddress.contains(":")) {
            String[] parts = listenAddress.split("\\.", -1);
            if (parts.length != 4) throw new IllegalArgumentException("Use a full IPv4 address");
            for (String part : parts) {
                if (!part.matches("0|[1-9][0-9]{0,2}") || Integer.parseInt(part) > 255) throw new IllegalArgumentException("Invalid IPv4 address");
            }
        }
        InetAddress address = InetAddress.getByName(listenAddress);
        if (address.isMulticastAddress() || listenAddress.equals("255.255.255.255")) throw new IllegalArgumentException("Invalid listen address");
        this.listenAddress = listenAddress;
        this.port = port;
        this.directory = directory.getCanonicalFile();
        if (!this.directory.isDirectory()) throw new IllegalArgumentException("Working directory does not exist");
        this.publicUrl = publicUrl.isEmpty() ? "" : validateUrl(publicUrl, true);
        if (address.isAnyLocalAddress() && this.publicUrl.isEmpty()) throw new IllegalArgumentException("Wildcard listening requires --public-url");
    }

    private static String validateUrl(String value, boolean reachable) {
        try {
            URI uri = new URI(value);
            String host = uri.getHost();
            if (!("http".equals(uri.getScheme()) || "https".equals(uri.getScheme())) || host == null
                    || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null
                    || !(uri.getRawPath().isEmpty() || uri.getRawPath().equals("/"))
                    || uri.getPort() == 0 || uri.getPort() > 65535 || value.contains("%")) throw new IllegalArgumentException();
            String numericHost = host.replace("[", "").replace("]", "");
            if (reachable && numericHost.matches("[0-9a-fA-F:.]+") && InetAddress.getByName(numericHost).isAnyLocalAddress()) throw new IllegalArgumentException();
            return uri.getScheme() + "://" + uri.getRawAuthority();
        } catch (Exception error) { throw new IllegalArgumentException("Expected an HTTP(S) origin without credentials, path or query"); }
    }

    public static ExecutorConfig parse(String[] args) throws IOException {
        Map<String, String> values = new HashMap<>();
        for (int i = 0; i < args.length; i += 2) {
            if (i + 1 == args.length || !args[i].matches("--(origin|listen-address|port|cwd|public-url)")
                    || values.put(args[i], args[i + 1]) != null) throw new IllegalArgumentException("Invalid or duplicate argument: " + args[i]);
        }
        if (!values.containsKey("--origin")) throw new IllegalArgumentException("--origin is required");
        return new ExecutorConfig(values.get("--origin"), values.getOrDefault("--listen-address", "127.0.0.1"),
                Integer.parseInt(values.getOrDefault("--port", "0")), new File(values.getOrDefault("--cwd", ".")), values.getOrDefault("--public-url", ""));
    }
}
