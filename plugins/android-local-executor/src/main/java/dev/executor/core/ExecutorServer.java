package dev.executor.core;

import fi.iki.elonen.NanoHTTPD;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.io.File;
import java.io.IOException;
import java.io.PrintStream;
import java.net.InetAddress;
import java.net.URI;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** 复用协议 v1：浏览器直连，认证通过后只提供任务接口。 */
public final class ExecutorServer extends NanoHTTPD implements AutoCloseable {
    private static final int MAX_BODY = 131072;
    private static final Pattern TASK_ROUTE = Pattern.compile("/v1/tasks/([a-zA-Z0-9_-]{8,80})(/cancel)?");
    private final ExecutorConfig config;
    private final ShellRuntime shell;
    private final TerminalLog log;
    private final String token;
    private final Map<String, CommandTask> tasks = new HashMap<>();
    private final Set<String> allowedHosts = new HashSet<>();
    private String endpoint;
    private boolean closed;

    public static final class ApiException extends RuntimeException {
        final int status;
        public ApiException(int status, String message) { super(message); this.status = status; }
    }

    public static JSONObject json(Object... entries) {
        JSONObject object = new JSONObject();
        try {
            for (int i = 0; i < entries.length; i += 2) object.put((String) entries[i], entries[i + 1] == null ? JSONObject.NULL : entries[i + 1]);
        } catch (JSONException failure) { throw new IllegalArgumentException(failure); }
        return object;
    }

    public ExecutorServer(ExecutorConfig config, ShellRuntime shell, PrintStream terminal) {
        super(config.listenAddress, config.port);
        this.config = config; this.shell = shell;
        byte[] secret = new byte[32]; new SecureRandom().nextBytes(secret);
        token = Base64.getUrlEncoder().withoutPadding().encodeToString(secret);
        log = new TerminalLog(terminal);
        // 本协议只接受有界 JSON，不调用文件上传解析，也不创建 HTTP 临时文件。
        setTempFileManagerFactory(() -> new TempFileManager() {
            @Override public void clear() {}
            @Override public TempFile createTempFile(String hint) throws Exception { throw new IOException("File uploads are not supported"); }
        });
    }

    public synchronized void startExecutor() throws IOException {
        if (closed || endpoint != null) throw new IllegalStateException("Executor already started or closed");
        start(10000, true);
        String host = config.listenAddress.contains(":") ? "[" + config.listenAddress + "]" : config.listenAddress;
        String listenUrl = "http://" + host + ":" + getListeningPort();
        endpoint = config.publicUrl.isEmpty() ? listenUrl : config.publicUrl;
        addHost(endpoint);
        if (!InetAddress.getByName(config.listenAddress).isAnyLocalAddress()) addHost(listenUrl);
    }

    private void addHost(String url) {
        URI uri = URI.create(url);
        String authority = uri.getRawAuthority().toLowerCase(Locale.ROOT);
        allowedHosts.add(authority);
        int defaultPort = uri.getScheme().equals("https") ? 443 : 80;
        if (uri.getPort() == -1) allowedHosts.add(authority + ":" + defaultPort);
        else if (uri.getPort() == defaultPort) allowedHosts.add(authority.substring(0, authority.lastIndexOf(':')));
    }

    public synchronized JSONObject connection() { return json("url", endpoint, "token", token); }

    private JSONObject info() {
        return json("protocol_version", 1, "runtime", shell.runtime(), "platform", shell.platform(), "shell", "sh",
                "shells", new JSONArray(Arrays.asList("sh")), "default_cwd", config.directory.getPath(), "output_buffer_chars", CommandTask.OUTPUT_LIMIT);
    }

    private void authorize(IHTTPSession request) {
        Map<String, String> headers = request.getHeaders();
        synchronized (this) {
            if (!allowedHosts.contains(headers.getOrDefault("host", "").toLowerCase(Locale.ROOT))) throw new ApiException(403, "Invalid Host");
        }
        if (!config.origin.equals(headers.get("origin"))) throw new ApiException(403, "Origin is not authorized");
        if (request.getMethod() != Method.OPTIONS && !MessageDigest.isEqual(("Bearer " + token).getBytes(StandardCharsets.UTF_8),
                headers.getOrDefault("authorization", "").getBytes(StandardCharsets.UTF_8))) throw new ApiException(401, "Invalid connection credentials");
    }

    private JSONObject readBody(IHTTPSession request) throws IOException, JSONException {
        Map<String, String> headers = request.getHeaders();
        String length = headers.getOrDefault("content-length", "");
        if (headers.containsKey("transfer-encoding") || !length.matches("[0-9]{1,10}")) throw new ApiException(400, "A Content-Length is required");
        long size = Long.parseLong(length);
        if (size > MAX_BODY) throw new ApiException(413, "Request is too large");
        if (!headers.getOrDefault("content-type", "").split(";", 2)[0].trim().equalsIgnoreCase("application/json")) throw new ApiException(415, "Expected application/json");
        byte[] bytes = new byte[(int) size];
        int offset = 0;
        while (offset < bytes.length) {
            int count = request.getInputStream().read(bytes, offset, bytes.length - offset);
            if (count == -1) throw new ApiException(400, "Incomplete body");
            offset += count;
        }
        String text = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
        JSONTokener parser = new JSONTokener(text);
        Object value = parser.nextValue();
        if (!(value instanceof JSONObject) || parser.nextClean() != 0) throw new ApiException(400, "Expected a JSON object");
        return (JSONObject) value;
    }

    private static String string(JSONObject body, String key, String fallback) {
        Object value = body.has(key) ? body.opt(key) : fallback;
        if (!(value instanceof String)) throw new ApiException(400, "Invalid " + key);
        return (String) value;
    }

    private synchronized JSONObject submit(JSONObject body) throws IOException {
        if (closed) throw new ApiException(410, "Executor is closed");
        String id = string(body, "id", "");
        String command = string(body, "command", "");
        String selectedShell = string(body, "shell", "sh");
        String cwd = string(body, "cwd", config.directory.getPath());
        if (!id.matches("[a-zA-Z0-9_-]{8,80}")) throw new ApiException(400, "Invalid task id");
        if (command.trim().isEmpty() || command.indexOf('\0') >= 0 || command.getBytes(StandardCharsets.UTF_8).length > 65536) throw new ApiException(400, "Invalid command");
        if (!selectedShell.equals("sh")) throw new ApiException(400, "Unsupported shell");
        if (cwd.indexOf('\0') >= 0) throw new ApiException(400, "Invalid working directory");
        File directory = cwd.isEmpty() ? config.directory : new File(cwd);
        if (!directory.isAbsolute()) directory = new File(config.directory, cwd);
        directory = directory.getCanonicalFile();
        if (!directory.isDirectory()) throw new ApiException(400, "Working directory does not exist");
        CommandTask existing = tasks.get(id);
        if (existing != null) {
            if (!existing.matches(command, directory)) throw new ApiException(409, "Task id already belongs to different execution content");
            return existing.snapshot(0);
        }
        CommandTask task = new CommandTask(id, command, directory, shell, log);
        Thread worker = new Thread(task, "executor-task-" + id);
        worker.setDaemon(true);
        tasks.put(id, task);
        try { worker.start(); }
        catch (RuntimeException failure) { tasks.remove(id); throw failure; }
        return task.snapshot(0);
    }

    private synchronized CommandTask task(String id) {
        CommandTask task = tasks.get(id);
        if (task == null) throw new ApiException(404, "Task not found");
        return task;
    }

    @Override public Response serve(IHTTPSession request) {
        try {
            authorize(request);
            String path = request.getUri();
            Matcher route = TASK_ROUTE.matcher(path);
            boolean taskRoute = route.matches();
            if (!path.equals("/v1/info") && !path.equals("/v1/tasks") && !taskRoute) throw new ApiException(404, "Unknown endpoint");
            if (request.getMethod() == Method.OPTIONS) {
                String method = request.getHeaders().get("access-control-request-method");
                if (!"GET".equals(method) && !"POST".equals(method)) throw new ApiException(405, "Unsupported method");
                for (String header : request.getHeaders().getOrDefault("access-control-request-headers", "").split(",")) {
                    if (!header.trim().isEmpty() && !header.trim().equalsIgnoreCase("authorization") && !header.trim().equalsIgnoreCase("content-type")) throw new ApiException(403, "Unsupported request headers");
                }
                return respond(request, 200, json());
            }
            JSONObject body = request.getMethod() == Method.POST ? readBody(request) : json();
            JSONObject result;
            if (request.getMethod() == Method.GET && path.equals("/v1/info")) result = info();
            else if (request.getMethod() == Method.POST && path.equals("/v1/tasks")) result = submit(body);
            else if (taskRoute) {
                CommandTask task = task(route.group(1));
                if (request.getMethod() == Method.POST && route.group(2) != null) { task.cancel(); result = task.snapshot(0); }
                else if (request.getMethod() == Method.GET && route.group(2) == null) {
                    String cursor = request.getParms().getOrDefault("cursor", "0");
                    if (!cursor.matches("[0-9]{1,16}")) throw new ApiException(400, "Invalid output cursor");
                    result = task.snapshot(Long.parseLong(cursor));
                } else throw new ApiException(405, "Unsupported method");
            } else throw new ApiException(405, "Unsupported method");
            return respond(request, 200, result);
        } catch (ApiException failure) { return respond(request, failure.status, json("error", failure.getMessage())); }
        catch (JSONException | IOException failure) { return respond(request, 400, json("error", "Invalid request body or path")); }
        catch (Exception failure) { return respond(request, 500, json("error", "Executor error")); }
    }

    private Response respond(IHTTPSession request, int status, JSONObject body) {
        Response response = newFixedLengthResponse(Response.Status.lookup(status), "application/json; charset=utf-8", body.toString());
        response.closeConnection(true);
        response.addHeader("Cache-Control", "no-store");
        response.addHeader("X-Content-Type-Options", "nosniff");
        if (config.origin.equals(request.getHeaders().get("origin"))) {
            response.addHeader("Access-Control-Allow-Origin", config.origin);
            response.addHeader("Vary", "Origin");
            response.addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            response.addHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
            response.addHeader("Access-Control-Allow-Private-Network", "true");
        }
        return response;
    }

    @Override public void close() {
        CommandTask[] active;
        synchronized (this) { if (closed) return; closed = true; active = tasks.values().toArray(new CommandTask[0]); }
        stop();
        for (CommandTask task : active) task.cancel();
        for (CommandTask task : active) task.awaitFinished();
        log.close();
    }
}
