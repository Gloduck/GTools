package dev.executor.core;

import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

/** 执行状态和输出收尾统一管理；终态发布后不再追加输出。 */
public final class CommandTask implements Runnable {
    public static final int OUTPUT_LIMIT = 262144;
    private final String id;
    private final String command;
    private final File directory;
    private final ShellRuntime shell;
    private final TerminalLog log;
    private final StringBuilder output = new StringBuilder();
    private final double createdAt = System.currentTimeMillis() / 1000.0;
    private long outputStart;
    private boolean truncated;
    private String status = "queued";
    private String error = "";
    private Integer exitCode;
    private boolean cancelled;
    private Process process;
    private int group;

    public CommandTask(String id, String command, File directory, ShellRuntime shell, TerminalLog log) {
        this.id = id; this.command = command; this.directory = directory; this.shell = shell; this.log = log;
    }

    public boolean matches(String value, File cwd) { return command.equals(value) && directory.equals(cwd); }
    private boolean finished() { return status.equals("completed") || status.equals("failed") || status.equals("cancelled"); }

    public synchronized JSONObject snapshot(long cursor) {
        int visible = output.length();
        if (visible > 0 && Character.isHighSurrogate(output.charAt(visible - 1))) visible--;
        long total = outputStart + visible;
        if (cursor < 0 || cursor > total) throw new ExecutorServer.ApiException(400, "Invalid output cursor");
        long start = Math.max(cursor, outputStart);
        if (start < total && Character.isLowSurrogate(output.charAt((int) (start - outputStart)))) throw new ExecutorServer.ApiException(400, "Cursor splits a character");
        long end = Math.min(total, start + 16384);
        // 游标按 UTF-16 单元计数，但每页保持完整字符，避免 JSON 编码损坏代理对。
        int index = (int) (end - outputStart);
        if (end < total && index > 0 && Character.isHighSurrogate(output.charAt(index - 1))) end--;
        return ExecutorServer.json("id", id, "status", status, "cwd", directory.getPath(), "shell", "sh",
                "output", output.substring((int) (start - outputStart), (int) (end - outputStart)),
                "cursor", end, "has_more", end < total, "exit_code", exitCode,
                "truncated", truncated, "output_lost", cursor < outputStart, "error", error, "created_at", createdAt);
    }

    private synchronized void append(char[] chars, int length) {
        output.append(chars, 0, length);
        int overflow = output.length() - OUTPUT_LIMIT;
        if (overflow > 0) {
            if (overflow < output.length() && Character.isLowSurrogate(output.charAt(overflow))) overflow++;
            output.delete(0, overflow); outputStart += overflow; truncated = true;
        }
    }

    public synchronized void cancel() {
        if (finished()) return;
        cancelled = true; status = "cancelling";
        cleanupProcess();
    }

    public void awaitFinished() {
        boolean interrupted = false;
        synchronized (this) {
            while (!finished()) {
                try { wait(); }
                catch (InterruptedException ignored) { interrupted = true; }
            }
        }
        if (interrupted) Thread.currentThread().interrupt();
    }

    private synchronized void cleanupProcess() {
        if (group > 0) {
            try { shell.killGroup(group); }
            catch (IOException | RuntimeException failure) { recordError("Cannot clean process group: " + failure.getMessage()); }
        }
        try { if (process != null && process.isAlive()) process.destroyForcibly(); }
        catch (RuntimeException failure) { recordError("Cannot terminate shell: " + failure.getMessage()); }
    }

    private synchronized void recordError(String message) { if (error.isEmpty()) error = message; }

    private void readOutput() {
        try (InputStreamReader reader = new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8)) {
            char[] chars = new char[4096];
            int count;
            // InputStreamReader 保持跨字节读取的 UTF-8 解码状态，并替换损坏字节。
            while ((count = reader.read(chars)) != -1) {
                append(chars, count);
                log.append(id, new String(chars, 0, count));
            }
        } catch (IOException | RuntimeException failure) {
            recordError("Output collection failed; output may be incomplete: " + failure.getMessage());
            cleanupProcess();
        }
    }

    private int readGroup() throws IOException {
        ByteArrayOutputStream line = new ByteArrayOutputStream();
        for (int i = 0; i < 64; i++) {
            int value = process.getInputStream().read();
            if (value == -1) break;
            if (value == '\n') {
                String text = new String(line.toByteArray(), StandardCharsets.US_ASCII);
                if (text.matches("EXECUTOR_PID=[1-9][0-9]{0,9}")) {
                    try { return Integer.parseInt(text.substring("EXECUTOR_PID=".length())); }
                    catch (NumberFormatException ignored) { break; }
                }
                break;
            }
            line.write(value);
        }
        throw new IOException("Cannot initialize an independent shell process group; check system setsid support and terminal permissions");
    }

    @Override public void run() {
        Thread reader = null;
        boolean readerStarted = false;
        log.append(id, "开始执行 | Shell: sh | 目录: " + directory + "\n" + command);
        try {
            synchronized (this) {
                if (cancelled) return;
                process = shell.start(command, directory);
                status = "running";
            }
            int pid = readGroup();
            shell.verifyGroup(pid);
            synchronized (this) {
                group = pid;
                if (cancelled) return;
                // 放行前已经登记进程组；stdin 放行后关闭，用户命令不能等待交互输入。
                process.getOutputStream().write('\n');
                process.getOutputStream().close();
            }
            reader = new Thread(this::readOutput, "executor-output-" + id);
            reader.setDaemon(true); reader.start(); readerStarted = true;
            process.waitFor();
        } catch (Exception failure) {
            synchronized (this) { if (!cancelled) recordError(failure.toString()); }
        } finally {
            cleanupProcess();
            boolean interrupted = false;
            if (process != null) {
                // 中断不能跳过进程回收和输出收尾，所有结束路径遵循同一顺序。
                while (true) {
                    try { exitCode = process.waitFor(); break; }
                    catch (InterruptedException ignored) { interrupted = true; }
                }
                if (readerStarted) {
                    while (reader.isAlive()) {
                        try { reader.join(); }
                        catch (InterruptedException failure) { interrupted = true; }
                    }
                }
                try { process.getInputStream().close(); process.getOutputStream().close(); process.getErrorStream().close(); }
                catch (IOException failure) { recordError("Cannot close process streams: " + failure.getMessage()); }
            }
            synchronized (this) {
                status = cancelled ? "cancelled" : (Integer.valueOf(0).equals(exitCode) && error.isEmpty() ? "completed" : "failed");
                log.append(id, "执行结束 | 状态: " + status + " | 退出码: " + exitCode + (error.isEmpty() ? "" : " | " + error));
                notifyAll();
            }
            if (interrupted) Thread.currentThread().interrupt();
        }
    }
}
