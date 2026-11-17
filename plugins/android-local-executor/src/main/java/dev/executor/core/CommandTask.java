package dev.executor.core;

import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharsetDecoder;
import java.nio.charset.CoderResult;
import java.nio.charset.StandardCharsets;

/** 执行状态和输出收尾统一管理；终态发布后不再追加输出。 */
public final class CommandTask implements Runnable {
    public static final int OUTPUT_LIMIT = 262144;
    public static final int DEFAULT_READ_CHARS = 5000;
    public static final int MAX_READ_CHARS = 20000;
    private final String id;
    private final String command;
    private final String lifecycle;
    private final File directory;
    private final ShellRuntime shell;
    private final TerminalLog log;
    private final StringBuilder output = new StringBuilder();
    private final double createdAt = System.currentTimeMillis() / 1000.0;
    private long outputStart;
    private boolean truncated;
    private boolean decodingLoss;
    private boolean outputIncomplete;
    private int outputChars;
    private String status = "queued";
    private String error = "";
    private Integer exitCode;
    private boolean cancelled;
    private Process process;
    private int group;
    private boolean scopeEmpty;
    private boolean settled;
    private volatile boolean scopeStopping;

    public CommandTask(String id, String command, File directory, String lifecycle, ShellRuntime shell, TerminalLog log) {
        this.id = id; this.command = command; this.directory = directory; this.lifecycle = lifecycle; this.shell = shell; this.log = log;
    }

    public boolean matches(String value, File cwd, String mode) { return command.equals(value) && directory.equals(cwd) && lifecycle.equals(mode); }
    private boolean finished() { return status.equals("completed") || status.equals("failed") || status.equals("cancelled"); }

    public JSONObject snapshot(long cursor) { return snapshot(cursor, DEFAULT_READ_CHARS); }

    public synchronized JSONObject snapshot(long cursor, int maxChars) {
        if (maxChars < 1 || maxChars > MAX_READ_CHARS) throw new ExecutorServer.ApiException(400, "max_chars must be an integer between 1 and 20000");
        int visible = output.length();
        if (visible > 0 && Character.isHighSurrogate(output.charAt(visible - 1))) visible--;
        long total = outputStart + visible;
        if (cursor < 0 || cursor > total) throw new ExecutorServer.ApiException(400, "Invalid output cursor");
        long start = Math.max(cursor, outputStart);
        if (start < total && Character.isLowSurrogate(output.charAt((int) (start - outputStart)))) throw new ExecutorServer.ApiException(400, "Cursor splits a character");
        // 数量按 Unicode 字符计数；游标保持不透明，调用方只需原样传回。
        int index = (int) (start - outputStart);
        for (int count = 0; index < visible && count < maxChars; count++) {
            index += Character.charCount(Character.codePointAt(output, index));
        }
        long end = outputStart + index;
        return ExecutorServer.json("id", id, "status", status, "cwd", directory.getPath(), "shell", "sh", "lifecycle", lifecycle,
                "output", output.substring((int) (start - outputStart), (int) (end - outputStart)),
                "cursor", end, "has_more", end < total, "exit_code", exitCode,
                "truncated", truncated, "output_lost", cursor < outputStart, "decoding_loss", decodingLoss, "output_incomplete", outputIncomplete, "error", error, "created_at", createdAt);
    }

    private synchronized void append(char[] chars, int length) {
        int added = Character.codePointCount(chars, 0, length);
        if (length > 0 && output.length() > 0 && Character.isHighSurrogate(output.charAt(output.length() - 1)) && Character.isLowSurrogate(chars[0])) added--;
        outputChars += added;
        output.append(chars, 0, length);
        int overflow = outputChars - OUTPUT_LIMIT;
        if (overflow > 0) {
            int removed = output.offsetByCodePoints(0, overflow);
            output.delete(0, removed); outputStart += removed; outputChars -= overflow; truncated = true;
        }
    }

    public synchronized void cancel() {
        if (finished()) return;
        cancelled = true;
        if (!settled) status = "cancelling";
        cleanupProcess();
    }

    public void awaitFinished() {
        boolean interrupted = false;
        synchronized (this) {
            while (!settled) {
                try { wait(); }
                catch (InterruptedException ignored) { interrupted = true; }
            }
        }
        if (interrupted) Thread.currentThread().interrupt();
    }

    private synchronized void cleanupProcess() {
        if (process != null && process.isAlive()) {
            try { sendControl("STOP"); scopeStopping = true; }
            catch (IOException failure) {
                // 关闭控制输入同样要求监管者清理自身组，不能对过期 PGID 补发信号。
                try { process.getOutputStream().close(); }
                catch (IOException ignored) { recordError("Cannot stop task supervisor: " + failure.getMessage()); }
            }
        }
    }

    private void sendControl(String action) throws IOException {
        process.getOutputStream().write((action + "\n").getBytes(StandardCharsets.US_ASCII));
        process.getOutputStream().flush();
    }

    private synchronized void recordError(String message) { if (error.isEmpty()) error = message; }

    private void awaitEmptyGroup() throws IOException, InterruptedException {
        long stoppedAt = 0;
        while (shell.hasBusinessProcesses(group)) {
            if (!process.isAlive()) {
                if (stoppedAt == 0) stoppedAt = System.nanoTime();
                if (!scopeStopping || System.nanoTime() - stoppedAt >= 1000000000L) {
                    synchronized (this) { outputIncomplete = true; }
                    throw new IOException("Task supervisor is gone while owned processes remain; cleanup cannot be confirmed");
                }
            }
            Thread.sleep(100);
        }
        scopeEmpty = true;
    }

    private String readControlLine() throws IOException, InterruptedException {
        // 报告器可能比监管者存活更久；只读取已就绪字节，半帧也不能阻塞身份检查。
        InputStream stream = process.getErrorStream();
        ByteArrayOutputStream line = new ByteArrayOutputStream();
        while (line.size() < 128) {
            if (stream.available() > 0) {
                int value = stream.read();
                if (value == '\n') return new String(line.toByteArray(), StandardCharsets.US_ASCII);
                if (value == -1) break;
                line.write(value);
            } else {
                if (!process.isAlive()) throw new IOException("Task supervisor exited before reporting the root command result");
                Thread.sleep(20);
            }
        }
        throw new IOException("Invalid task supervisor control frame");
    }

    private void readOutput() {
        try (InputStream stream = process.getInputStream()) {
            CharsetDecoder decoder = StandardCharsets.UTF_8.newDecoder();
            ByteBuffer bytes = ByteBuffer.allocate(4096);
            CharBuffer chars = CharBuffer.allocate(4096);
            boolean end = false;
            while (!end) {
                int count = stream.read(bytes.array(), bytes.position(), bytes.remaining());
                end = count == -1;
                if (!end) bytes.position(bytes.position() + count);
                bytes.flip();
                while (true) {
                    CoderResult result = decoder.decode(bytes, chars, end);
                    publishOutput(chars);
                    if (result.isError()) {
                        // 只替换解码器确认的非法字节，不把用户原有的 � 当作损失。
                        synchronized (this) { decodingLoss = true; }
                        bytes.position(bytes.position() + result.length());
                        chars.put('\uFFFD');
                    } else if (result.isUnderflow()) break;
                }
                bytes.compact();
            }
            while (true) {
                CoderResult result = decoder.flush(chars);
                publishOutput(chars);
                if (result.isUnderflow()) break;
            }
        } catch (IOException | RuntimeException failure) {
            synchronized (this) { outputIncomplete = true; }
            recordError("Output collection failed; output may be incomplete: " + failure.getMessage());
            cleanupProcess();
        }
    }

    private void publishOutput(CharBuffer chars) {
        int count = chars.position();
        append(chars.array(), count);
        if (count > 0) log.append(id, new String(chars.array(), 0, count));
        chars.clear();
    }

    private int readGroup() throws IOException, InterruptedException {
        String text = readControlLine();
        if (text.matches("READY [1-9][0-9]{0,9}")) {
            try { return Integer.parseInt(text.substring("READY ".length())); }
            catch (NumberFormatException ignored) { /* 使用统一的初始化错误。 */ }
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
                // 控制 stdin 留给监管者，业务命令的 stdin 由监管脚本接到 /dev/null。
                sendControl("START");
            }
            reader = new Thread(this::readOutput, "executor-output-" + id);
            reader.setDaemon(true); reader.start(); readerStarted = true;
            while (true) {
                String line = readControlLine();
                if (line.matches("EXIT [0-9]+")) {
                    synchronized (this) { exitCode = Integer.parseInt(line.substring(5)); }
                    break;
                }
            }
            synchronized (this) {
                if (exitCode == null && !cancelled) throw new IOException("Task supervisor exited before reporting the root command result");
                if (lifecycle.equals("task") || cancelled) cleanupProcess();
            }
            awaitEmptyGroup();
            synchronized (this) { if (process.isAlive()) sendControl("FINISH"); }
            process.waitFor();
        } catch (Exception failure) {
            synchronized (this) { if (!cancelled) recordError(failure.toString()); }
        } finally {
            cleanupProcess();
            boolean interrupted = false;
            if (process != null) {
                // 中断不能跳过进程回收和输出收尾，所有结束路径遵循同一顺序。
                while (true) {
                    try { process.waitFor(); break; }
                    catch (InterruptedException ignored) { interrupted = true; }
                }
                if (group > 0 && !scopeEmpty) {
                    while (true) {
                        try { awaitEmptyGroup(); break; }
                        catch (InterruptedException ignored) { interrupted = true; }
                        catch (IOException | RuntimeException failure) { recordError("Cannot inspect task process group: " + failure.getMessage()); break; }
                    }
                }
                if (readerStarted) {
                    while (reader.isAlive()) {
                        try { reader.join(scopeEmpty ? 0 : 1000); if (!scopeEmpty) break; }
                        catch (InterruptedException failure) { interrupted = true; if (!scopeEmpty) break; }
                    }
                    if (reader.isAlive()) synchronized (this) {
                        outputIncomplete = true;
                        recordError("Output collection is incomplete after losing task supervision");
                    }
                }
                try {
                    if (!readerStarted || !reader.isAlive()) process.getInputStream().close();
                    process.getOutputStream().close();
                    process.getErrorStream().close();
                }
                catch (IOException failure) { recordError("Cannot close process streams: " + failure.getMessage()); }
            }
            synchronized (this) {
                // 无法确认组已清空时保留未知状态，不能把查询失败当成执行结束。
                status = group > 0 && !scopeEmpty ? "unknown" : cancelled ? "cancelled" : (Integer.valueOf(0).equals(exitCode) && error.isEmpty() ? "completed" : "failed");
                settled = true;
                log.append(id, "执行结束 | 状态: " + status + " | 退出码: " + exitCode + (error.isEmpty() ? "" : " | " + error));
                notifyAll();
            }
            if (interrupted) Thread.currentThread().interrupt();
        }
    }
}
