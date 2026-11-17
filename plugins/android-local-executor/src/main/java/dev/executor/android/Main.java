package dev.executor.android;

import android.os.Build;
import dev.executor.core.ExecutorConfig;
import dev.executor.core.ExecutorServer;
import java.io.PrintStream;
import java.util.concurrent.CountDownLatch;

/** app_process 入口；仅使用调用终端的现有权限，不自动请求 root。 */
public final class Main {
    public static void main(String[] args) throws Exception {
        if (Build.VERSION.SDK_INT < 26) throw new IllegalStateException("Android 8.0 or newer is required");
        ExecutorConfig config = ExecutorConfig.parse(args);
        PrintStream terminal = new PrintStream(System.err, true, "UTF-8");
        ExecutorServer server = new ExecutorServer(config, new AndroidShell(), terminal);
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            server.close();
            terminal.println(config.messages.text("执行器已停止。", "Executor stopped."));
        }, "executor-shutdown"));
        try {
            server.startExecutor();
            terminal.println(config.messages.text("命令执行器：请保持此终端打开，按 Ctrl+C 断开连接。", "Command executor: keep this terminal open. Ctrl+C disconnects."));
            terminal.println(config.messages.text("命令使用当前终端权限执行，默认目录：%s", "Commands run with current terminal permissions. Default directory: %s", config.directory));
            terminal.println(config.messages.text("请将以下连接信息粘贴到 AI Agent 的执行器连接框：", "Paste this connection into the AI Agent Executor connection dialog:"));
            new PrintStream(System.out, true, "UTF-8").println(server.connection());
            new CountDownLatch(1).await();
        } finally { server.close(); }
    }
}
