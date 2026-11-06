package dev.executor.core;

import java.io.PrintStream;
import java.util.ArrayDeque;

/** 日志是独立的终端副本，慢终端不能阻塞命令输出采集。 */
public final class TerminalLog implements AutoCloseable {
    private static final int LIMIT = 262144;
    private final ArrayDeque<String> pending = new ArrayDeque<>();
    private final PrintStream sink;
    private int pendingChars;
    private long dropped;
    private boolean closed;
    private final Thread worker;

    public TerminalLog(PrintStream sink) {
        this.sink = sink;
        worker = new Thread(this::writeLoop, "executor-terminal");
        worker.setDaemon(true);
        worker.start();
    }

    public synchronized void append(String id, String text) {
        if (closed || text.isEmpty()) return;
        String line = "[" + id + "] " + text + (text.endsWith("\n") ? "" : "\n");
        if (line.length() > LIMIT) {
            dropped += line.length() - LIMIT;
            line = line.substring(line.length() - LIMIT);
        }
        while (!pending.isEmpty() && pendingChars + line.length() > LIMIT) {
            String removed = pending.removeFirst();
            pendingChars -= removed.length();
            dropped += removed.length();
        }
        pending.addLast(line);
        pendingChars += line.length();
        notifyAll();
    }

    private void writeLoop() {
        try {
            while (true) {
                String text;
                long skipped;
                synchronized (this) {
                    while (pending.isEmpty() && !closed) wait();
                    if (pending.isEmpty()) return;
                    text = pending.removeFirst();
                    pendingChars -= text.length();
                    skipped = dropped;
                    dropped = 0;
                }
                if (skipped > 0) sink.println("[Executor] 终端日志积压，已省略 " + skipped + " 字符；任务输出请以接口缓存为准。");
                sink.print(text);
                sink.flush();
            }
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
    }

    @Override public void close() {
        synchronized (this) { closed = true; notifyAll(); }
        try { worker.join(1000); }
        catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
    }
}
