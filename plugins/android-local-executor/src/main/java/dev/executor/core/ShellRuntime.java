package dev.executor.core;

import java.io.File;
import java.io.IOException;

/** 系统差异只放在启动与进程组管理层，任务协议和输出处理共用。 */
public interface ShellRuntime {
    String runtime();
    String platform();
    Process start(String command, File directory) throws IOException;
    void verifyGroup(int pid) throws IOException;
    void killGroup(int pid) throws IOException;

    // 先报告独立进程组编号并等待放行，避免取消发生在 setsid 与执行用户命令之间。
    String START_SCRIPT = "printf 'EXECUTOR_PID=%s\\n' \"$$\"; "
            + "IFS= read -r executor_ready || exit 1; exec \"$1\" -c \"$2\"";
}
