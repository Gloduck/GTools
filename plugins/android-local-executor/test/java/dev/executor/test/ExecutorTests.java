package dev.executor.test;

import dev.executor.android.AndroidShell;
import dev.executor.core.ExecutorConfig;
import dev.executor.core.ExecutorServer;
import dev.executor.core.ShellRuntime;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.PrintStream;
import java.net.HttpURLConnection;
import java.net.Socket;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

/** JVM 与 Android 共用真实 HTTP 协议测试；不依赖 JUnit、ADB 或自动提权。 */
public final class ExecutorTests {
    private static final String ORIGIN = "https://executor-test.example";
    private final File directory;
    private final TrackingShell shell;
    private final ByteArrayOutputStream terminal = new ByteArrayOutputStream();
    private ExecutorServer server;
    private String endpoint;
    private String token;
    private int passed;

    private interface Scenario { void run() throws Exception; }

    private ExecutorTests(File directory, ShellRuntime runtime) {
        this.directory = directory;
        shell = new TrackingShell(runtime);
    }

    public static void main(String[] args) throws Exception {
        if (args.length > 1) throw new IllegalArgumentException("只接受一个可选的测试临时目录参数");
        // 桌面 JDK 默认限制 Origin/Host；Host 专项仍用原始 Socket，避免依赖其实现细节。
        System.setProperty("sun.net.http.allowRestrictedHeaders", "true");
        boolean android = System.getProperty("java.vm.name", "").toLowerCase(Locale.ROOT).contains("dalvik");
        File parent = new File(args.length == 1 ? args[0] : System.getProperty("user.dir", ".")).getCanonicalFile();
        File temporary = Files.createTempDirectory(parent.toPath(), "executor-test-").toFile();
        ExecutorTests tests = new ExecutorTests(temporary, android ? new AndroidShell() : new HostShell());
        try {
            tests.server = new ExecutorServer(new ExecutorConfig(ORIGIN, "127.0.0.1", 0, temporary, ""),
                    tests.shell, new PrintStream(tests.terminal, true, "UTF-8"));
            tests.server.startExecutor();
            JSONObject connection = tests.server.connection();
            tests.endpoint = connection.getString("url");
            tests.token = connection.getString("token");
            System.out.println(android ? "测试环境：Android 当前终端权限，未自动调用 su。"
                    : "测试环境：Linux JVM 共享协议；不代表 Android 实机通过。");
            tests.run("连接信息不泄露凭据", tests::testInfo);
            tests.run("认证来源与 Host 校验", tests::testAuthorization);
            tests.run("跨域预检及禁止额外请求头", tests::testPreflight);
            tests.run("任务参数路由和请求体校验", tests::testParameters);
            tests.run("重复提交不重复执行", tests::testIdempotency);
            tests.run("中文多行标准输出错误输出及退出码", tests::testUnicodeAndExitCode);
            tests.run("特殊路径与指定工作目录", tests::testPaths);
            tests.run("空输出和命令失败状态", tests::testEmptyOutputAndFailure);
            tests.run("分页保持中文及表情完整", tests::testPagination);
            tests.run("输出缓存滚动明确提示丢失", tests::testOutputRollover);
            tests.run("运行期间实时输出且终态稳定", tests::testStreamingOutput);
            tests.run("取消任务清理子进程", tests::testCancellation);
            tests.run("关闭服务清理运行任务", tests::testShutdown);
            check(!new String(tests.terminal.toByteArray(), StandardCharsets.UTF_8).contains(tests.token), "终端日志泄露连接凭据");
            System.out.println("全部场景通过：" + tests.passed + "；失败：0；跳过：0。");
        } finally {
            try {
                if (tests.server != null) tests.server.close();
                tests.shell.cleanup();
            } finally { removeTree(temporary); }
        }
    }

    private void run(String name, Scenario scenario) throws Exception {
        try { scenario.run(); }
        catch (Exception failure) { throw new AssertionError("场景失败：" + name, failure); }
        catch (AssertionError failure) { throw new AssertionError("场景失败：" + name + "：" + failure.getMessage(), failure); }
        passed++;
        System.out.println("场景通过：" + name);
    }

    private void testInfo() throws Exception {
        JSONObject info = request("GET", "/v1/info", null).expect(200);
        check(info.getInt("protocol_version") == 1, "协议版本错误");
        check(info.getString("runtime").equals(shell.runtime()), "运行时信息错误");
        check(info.getString("platform").equals(shell.platform()), "平台信息错误");
        check(info.getString("shell").equals("sh"), "默认 Shell 错误");
        check(info.getJSONArray("shells").length() == 1 && info.getJSONArray("shells").getString(0).equals("sh"), "Shell 列表错误");
        check(info.getString("default_cwd").equals(directory.getCanonicalPath()), "默认工作目录错误");
        check(info.getInt("output_buffer_chars") > 16384, "输出缓存信息错误");
        check(!info.has("token") && !info.toString().contains(token), "连接信息包含凭据");
    }

    private void testAuthorization() throws Exception {
        request("GET", "/v1/info", null, headers("Authorization", "Bearer wrong")).expect(401);
        Response wrongOrigin = request("GET", "/v1/info", null, headers("Origin", "https://other.example"));
        wrongOrigin.expect(403);
        check(wrongOrigin.header("Access-Control-Allow-Origin") == null, "错误来源被允许跨域");
        raw("GET", "/v1/info", headers("Host", "untrusted.example"), null).expect(403);
        raw("GET", "/v1/info", headers("Origin", "null"), null).expect(403);
        raw("GET", "/v1/info", headers("Authorization", ""), null).expect(401);
    }

    private void testPreflight() throws Exception {
        Map<String, String> headers = headers("Authorization", "", "Access-Control-Request-Method", "POST",
                "Access-Control-Request-Headers", "authorization,content-type", "Access-Control-Request-Private-Network", "true");
        Response response = request("OPTIONS", "/v1/tasks", null, headers);
        response.expect(200);
        check(ORIGIN.equals(response.header("Access-Control-Allow-Origin")), "合法预检未返回指定来源");
        check("true".equals(response.header("Access-Control-Allow-Private-Network")), "缺少私有网络预检响应");
        headers.put("Access-Control-Request-Headers", "authorization,x-untrusted");
        request("OPTIONS", "/v1/tasks", null, headers).expect(403);
        headers.put("Access-Control-Request-Headers", "authorization");
        headers.put("Access-Control-Request-Method", "DELETE");
        request("OPTIONS", "/v1/tasks", null, headers).expect(405);
    }

    private void testParameters() throws Exception {
        request("GET", "/v1/tasks", null).expect(405);
        raw("GET", "/../../private", Collections.emptyMap(), null).expect(404);
        request("GET", "/v1/tasks/unknown-task", null).expect(404);
        JSONObject[] invalid = {
                json("id", "../invalid", "command", "pwd"),
                json("id", id(), "command", " "),
                json("id", id(), "command", 12),
                json("id", id(), "command", "pwd", "shell", "powershell"),
                json("id", id(), "command", "pwd", "shell", new JSONArray()),
                json("id", id(), "command", "pwd", "cwd", new JSONArray()),
                json("id", id(), "command", "pwd", "cwd", new File(directory, "missing").getPath())
        };
        for (JSONObject body : invalid) request("POST", "/v1/tasks", body.toString()).expect(400);
        request("POST", "/v1/tasks", "[]").expect(400);
        request("POST", "/v1/tasks", "{} trailing").expect(400);
        request("POST", "/v1/tasks", "{}", headers("Content-Type", "text/plain")).expect(415);
        request("POST", "/v1/tasks", repeat("x", 131073)).expect(413);
        String task = submit(":");
        waitTask(task);
        request("GET", "/v1/tasks/" + task + "?cursor=-1", null).expect(400);
        request("GET", "/v1/tasks/" + task + "?cursor=999999999", null).expect(400);
    }

    private void testIdempotency() throws Exception {
        String task = id();
        JSONObject body = json("id", task, "command", "printf x >> once.txt", "shell", "sh");
        request("POST", "/v1/tasks", body.toString()).expect(200);
        JSONObject done = waitTask(task);
        check(done.getString("status").equals("completed"), "首次任务未成功");
        request("POST", "/v1/tasks", body.toString()).expect(200);
        check(readFile(new File(directory, "once.txt")).equals("x"), "重复提交重复执行了命令");
        body.put("command", "printf y >> once.txt");
        request("POST", "/v1/tasks", body.toString()).expect(409);
    }

    private void testUnicodeAndExitCode() throws Exception {
        String task = submit("printf '第一行中文\\n第二行 & []\\n'; printf '标准错误中文\\n' >&2; exit 7");
        JSONObject done = waitTask(task);
        check(done.getString("status").equals("failed") && done.getInt("exit_code") == 7, "未保留原生退出码");
        check(output(task, done).equals("第一行中文\n第二行 & []\n标准错误中文\n"), "中文、多行或合并错误输出损坏");
    }

    private void testPaths() throws Exception {
        File cwd = new File(directory, "中文 目录 & [1]");
        check(cwd.mkdir(), "无法创建路径夹具");
        File file = new File(cwd, "中文 文件 & [2].txt");
        Files.write(file.toPath(), "路径内容😀\n".getBytes(StandardCharsets.UTF_8));
        String task = id();
        request("POST", "/v1/tasks", json("id", task, "command", "pwd; cat " + quote(file.getName()), "cwd", cwd.getPath()).toString()).expect(200);
        JSONObject done = waitTask(task);
        check(done.getInt("exit_code") == 0, "特殊路径命令失败");
        check(output(task, done).equals(cwd.getCanonicalPath() + "\n路径内容😀\n"), "工作目录或文件路径解释错误");
    }

    private void testEmptyOutputAndFailure() throws Exception {
        String task = submit(":");
        JSONObject done = waitTask(task);
        check(done.getInt("exit_code") == 0 && output(task, done).isEmpty(), "空输出被错误补充内容");
        for (String command : new String[]{"cat ./executor-missing-file", "executor-command-does-not-exist"}) {
            task = submit(command); done = waitTask(task);
            check(done.getString("status").equals("failed") && done.getInt("exit_code") != 0, "失败命令被报告成功");
            check(!output(task, done).isEmpty(), "失败命令缺少错误输出");
        }
    }

    private void testPagination() throws Exception {
        // 首个表情恰好跨越默认分页边界，检查 JSON 中不会生成孤立代理对。
        String expected = repeat("a", 16383) + repeat("😀中文\n", 12000);
        Files.write(new File(directory, "pages.txt").toPath(), expected.getBytes(StandardCharsets.UTF_8));
        String task = submit("cat pages.txt");
        JSONObject done = waitTask(task);
        check(done.getBoolean("has_more") && !done.getBoolean("truncated"), "分页夹具未产生预期分页");
        check(output(task, done).equals(expected), "多页中文或表情内容不完整");
        request("GET", "/v1/tasks/" + task + "?cursor=16384", null).expect(400);
        JSONObject again = request("GET", "/v1/tasks/" + task, null).expect(200);
        check(again.getLong("cursor") == done.getLong("cursor") && again.getString("output").equals(done.getString("output")), "终态后分页内容发生变化");
    }

    private void testOutputRollover() throws Exception {
        int limit = request("GET", "/v1/info", null).expect(200).getInt("output_buffer_chars");
        String expected = repeat("😀中", limit / 2) + "结束标记😀";
        Files.write(new File(directory, "rolling.txt").toPath(), expected.getBytes(StandardCharsets.UTF_8));
        String task = submit("cat rolling.txt");
        JSONObject done = waitTask(task);
        check(done.getBoolean("truncated") && done.getBoolean("output_lost"), "输出滚动未报告丢失");
        int start = expected.length() - limit;
        if (Character.isLowSurrogate(expected.charAt(start))) start++;
        check(output(task, done).equals(expected.substring(start)), "滚动缓存未保留完整末尾字符");
    }

    private void testStreamingOutput() throws Exception {
        String task = submit("printf '开始\\n'; sleep 2; printf '结束😀\\n'");
        JSONObject first = waitOutput(task, "开始\n");
        check(first.getString("status").equals("running"), "首段输出直到结束才可见");
        long cursor = first.getLong("cursor");
        JSONObject done = waitTask(task);
        JSONObject tail = request("GET", "/v1/tasks/" + task + "?cursor=" + cursor, null).expect(200);
        check(tail.getString("output").equals("结束😀\n"), "增量输出遗漏或重复");
        Thread.sleep(80);
        JSONObject stable = request("GET", "/v1/tasks/" + task, null).expect(200);
        check(stable.getLong("cursor") == done.getLong("cursor") && stable.getString("output").equals(done.getString("output")), "终态发布后仍有新增输出");
    }

    private void testCancellation() throws Exception {
        String task = submit("sleep 30 & printf 'CHILD=%s\\n' \"$!\"; wait");
        int child = childPid(waitOutput(task, "CHILD="));
        request("POST", "/v1/tasks/" + task + "/cancel", "{}").expect(200);
        check(waitTask(task).getString("status").equals("cancelled"), "任务取消状态错误");
        waitDead(child);
        String checkTask = submit("printf '仍可执行'");
        check(output(checkTask, waitTask(checkTask)).equals("仍可执行"), "取消后无法继续接受任务");
    }

    private void testShutdown() throws Exception {
        String task = submit("sleep 30 & printf 'CHILD=%s\\n' \"$!\"; wait");
        int child = childPid(waitOutput(task, "CHILD="));
        server.close();
        waitDead(child);
        shell.waitStopped();
        boolean unreachable = false;
        try { request("GET", "/v1/info", null); }
        catch (IOException expected) { unreachable = true; }
        check(unreachable, "关闭后 HTTP 服务仍在监听");
    }

    private String submit(String command) throws Exception {
        String task = id();
        request("POST", "/v1/tasks", json("id", task, "command", command, "shell", "sh").toString()).expect(200);
        return task;
    }

    private JSONObject waitTask(String id) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15);
        do {
            JSONObject task = request("GET", "/v1/tasks/" + id, null).expect(200);
            String status = task.getString("status");
            if (status.equals("completed") || status.equals("failed") || status.equals("cancelled")) return task;
            Thread.sleep(20);
        } while (System.nanoTime() < deadline);
        throw new AssertionError("等待任务结束超时");
    }

    private JSONObject waitOutput(String id, String marker) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        do {
            JSONObject task = request("GET", "/v1/tasks/" + id, null).expect(200);
            if (task.getString("output").contains(marker)) return task;
            Thread.sleep(20);
        } while (System.nanoTime() < deadline);
        throw new AssertionError("等待命令输出超时");
    }

    private String output(String id, JSONObject task) throws Exception {
        StringBuilder result = new StringBuilder();
        while (true) {
            String page = task.getString("output");
            check(page.isEmpty() || !Character.isLowSurrogate(page.charAt(0)), "分页从孤立低代理开始");
            check(page.isEmpty() || !Character.isHighSurrogate(page.charAt(page.length() - 1)), "分页在孤立高代理结束");
            result.append(page);
            if (!task.getBoolean("has_more")) return result.toString();
            long cursor = task.getLong("cursor");
            task = request("GET", "/v1/tasks/" + id + "?cursor=" + cursor, null).expect(200);
            check(task.getLong("cursor") > cursor, "分页游标未前进");
        }
    }

    private Response request(String method, String path, String body) throws Exception {
        return request(method, path, body, Collections.emptyMap());
    }

    private Response request(String method, String path, String body, Map<String, String> overrides) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint + path).openConnection();
        connection.setConnectTimeout(4000); connection.setReadTimeout(8000); connection.setInstanceFollowRedirects(false);
        connection.setRequestMethod(method);
        connection.setRequestProperty("Origin", ORIGIN);
        connection.setRequestProperty("Authorization", "Bearer " + token);
        if (body != null) connection.setRequestProperty("Content-Type", "application/json");
        for (Map.Entry<String, String> header : overrides.entrySet()) connection.setRequestProperty(header.getKey(), header.getValue());
        try {
            if (body != null) {
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                connection.setDoOutput(true); connection.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream stream = connection.getOutputStream()) { stream.write(bytes); }
            }
            int status = connection.getResponseCode();
            Map<String, String> headers = new HashMap<>();
            for (Map.Entry<String, List<String>> header : connection.getHeaderFields().entrySet()) {
                if (header.getKey() != null && !header.getValue().isEmpty()) headers.put(header.getKey().toLowerCase(Locale.ROOT), header.getValue().get(0));
            }
            try (InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream()) {
                return new Response(status, headers, new String(readBytes(stream), StandardCharsets.UTF_8));
            }
        } finally { connection.disconnect(); }
    }

    private Response raw(String method, String path, Map<String, String> overrides, String body) throws Exception {
        URI uri = URI.create(endpoint);
        Map<String, String> headers = headers("Host", uri.getRawAuthority(), "Origin", ORIGIN,
                "Authorization", "Bearer " + token, "Connection", "close");
        headers.putAll(overrides);
        byte[] bytes = body == null ? new byte[0] : body.getBytes(StandardCharsets.UTF_8);
        if (body != null) { headers.put("Content-Length", String.valueOf(bytes.length)); headers.put("Content-Type", "application/json"); }
        try (Socket socket = new Socket(uri.getHost(), uri.getPort())) {
            socket.setSoTimeout(8000);
            StringBuilder head = new StringBuilder(method).append(' ').append(path).append(" HTTP/1.1\r\n");
            for (Map.Entry<String, String> header : headers.entrySet()) head.append(header.getKey()).append(": ").append(header.getValue()).append("\r\n");
            socket.getOutputStream().write(head.append("\r\n").toString().getBytes(StandardCharsets.US_ASCII));
            socket.getOutputStream().write(bytes); socket.getOutputStream().flush();
            String response = new String(readBytes(socket.getInputStream()), StandardCharsets.UTF_8);
            int split = response.indexOf("\r\n\r\n");
            check(split >= 0, "HTTP 响应头不完整");
            String[] lines = response.substring(0, split).split("\r\n");
            int status = Integer.parseInt(lines[0].split(" ")[1]);
            Map<String, String> responseHeaders = new HashMap<>();
            for (int i = 1; i < lines.length; i++) {
                int colon = lines[i].indexOf(':');
                if (colon > 0) responseHeaders.put(lines[i].substring(0, colon).toLowerCase(Locale.ROOT), lines[i].substring(colon + 1).trim());
            }
            return new Response(status, responseHeaders, response.substring(split + 4));
        }
    }

    private static final class Response {
        final int status;
        final Map<String, String> headers;
        final String text;
        Response(int status, Map<String, String> headers, String text) { this.status = status; this.headers = headers; this.text = text; }
        JSONObject expect(int expected) throws Exception {
            check(status == expected, "HTTP 状态应为 " + expected + "，实际为 " + status);
            return new JSONObject(text);
        }
        String header(String name) { return headers.get(name.toLowerCase(Locale.ROOT)); }
    }

    /** JVM 测试只替换系统进程组接口；不替换 HTTP、任务状态或输出采集实现。 */
    private static final class HostShell implements ShellRuntime {
        @Override public String runtime() { return "host-test"; }
        @Override public String platform() { return "linux"; }
        @Override public Process start(String command, File cwd) throws IOException {
            String setsid = new File("/usr/bin/setsid").isFile() ? "/usr/bin/setsid" : "/bin/setsid";
            return new ProcessBuilder(setsid, "/bin/sh", "-c", START_SCRIPT, "executor-task", "/bin/sh", command)
                    .directory(cwd).redirectErrorStream(true).start();
        }
        @Override public void verifyGroup(int pid) throws IOException {
            String[] state = processState(pid);
            if (pid <= 1 || state == null || Integer.parseInt(state[2]) != pid) throw new IOException("未建立独立进程组");
        }
        @Override public void killGroup(int pid) throws IOException {
            if (pid <= 1) throw new IOException("非法进程组");
            Process kill = new ProcessBuilder("/bin/kill", "-KILL", "--", "-" + pid).redirectErrorStream(true).start();
            try {
                readBytes(kill.getInputStream());
                if (kill.waitFor() != 0 && processAlive(pid)) throw new IOException("无法终止测试进程组");
            } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); throw new IOException(interrupted); }
            finally { kill.getInputStream().close(); kill.getOutputStream().close(); kill.getErrorStream().close(); }
        }
    }

    /** 最外层记录测试创建的资源，断言中途失败时也会清理进程和进程组。 */
    private static final class TrackingShell implements ShellRuntime {
        final ShellRuntime delegate;
        final List<Process> processes = Collections.synchronizedList(new ArrayList<>());
        final Set<Integer> groups = Collections.synchronizedSet(new HashSet<>());
        TrackingShell(ShellRuntime delegate) { this.delegate = delegate; }
        @Override public String runtime() { return delegate.runtime(); }
        @Override public String platform() { return delegate.platform(); }
        @Override public Process start(String command, File directory) throws IOException {
            Process process = delegate.start(command, directory); processes.add(process); return process;
        }
        @Override public void verifyGroup(int pid) throws IOException { delegate.verifyGroup(pid); groups.add(pid); }
        @Override public void killGroup(int pid) throws IOException { delegate.killGroup(pid); groups.remove(pid); }
        void waitStopped() throws Exception {
            List<Process> copy;
            synchronized (processes) { copy = new ArrayList<>(processes); }
            for (Process process : copy) check(process.waitFor(5, TimeUnit.SECONDS), "关闭服务后测试进程仍在运行");
        }
        void cleanup() throws Exception {
            List<Integer> remaining;
            synchronized (groups) { remaining = new ArrayList<>(groups); }
            IOException first = null;
            for (int group : remaining) {
                try { killGroup(group); }
                catch (IOException failure) { if (first == null) first = failure; }
            }
            synchronized (processes) {
                for (Process process : processes) {
                    if (process.isAlive()) process.destroyForcibly();
                    process.waitFor(5, TimeUnit.SECONDS);
                    process.getInputStream().close(); process.getOutputStream().close(); process.getErrorStream().close();
                }
            }
            if (first != null) throw first;
        }
    }

    private static String[] processState(int pid) throws IOException {
        File stat = new File("/proc/" + pid + "/stat");
        if (!stat.exists()) return null;
        String text;
        try { text = readFile(stat); }
        catch (IOException failure) { if (!stat.exists()) return null; throw failure; }
        int end = text.lastIndexOf(')');
        if (end < 0) throw new IOException("进程状态格式错误");
        return text.substring(end + 2).trim().split(" +");
    }
    private static boolean processAlive(int pid) throws IOException {
        String[] state = processState(pid);
        return state != null && !state[0].equals("Z");
    }
    private static int childPid(JSONObject task) throws Exception {
        String text = task.getString("output");
        int start = text.indexOf("CHILD=") + 6;
        int end = text.indexOf('\n', start);
        check(start >= 6 && end > start, "缺少完整子进程编号");
        return Integer.parseInt(text.substring(start, end).trim());
    }
    private static void waitDead(int pid) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        while (processAlive(pid) && System.nanoTime() < deadline) Thread.sleep(20);
        check(!processAlive(pid), "测试子进程未被清理");
    }
    private static byte[] readBytes(InputStream stream) throws IOException {
        if (stream == null) return new byte[0];
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        int size;
        while ((size = stream.read(buffer)) != -1) output.write(buffer, 0, size);
        return output.toByteArray();
    }
    private static String readFile(File file) throws IOException { return new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8); }
    private static JSONObject json(Object... entries) { return ExecutorServer.json(entries); }
    private static Map<String, String> headers(String... pairs) {
        Map<String, String> result = new HashMap<>();
        for (int i = 0; i < pairs.length; i += 2) result.put(pairs[i], pairs[i + 1]);
        return result;
    }
    private static String id() { return UUID.randomUUID().toString().replace("-", ""); }
    private static String quote(String value) { return "'" + value.replace("'", "'\"'\"'") + "'"; }
    private static String repeat(String text, int times) { StringBuilder out = new StringBuilder(); for (int i = 0; i < times; i++) out.append(text); return out.toString(); }
    private static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    private static void removeTree(File file) throws IOException {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) removeTree(child);
        if (!file.delete() && file.exists()) throw new IOException("无法清理测试临时文件：" + file.getName());
    }
}
