package dev.executor.core;

import java.io.File;
import java.io.IOException;

/** 系统差异只放在启动与进程组管理层，任务协议和输出处理共用。 */
public interface ShellRuntime {
    String runtime();
    String platform();
    Process start(String command, File directory) throws IOException;
    void verifyGroup(int pid) throws IOException;
    boolean hasBusinessProcesses(int group) throws IOException;

    // 监管者常驻占有组身份；控制走 stderr，业务 stderr 合并到业务 stdout。
    String START_SCRIPT = "printf 'READY %s\\n' \"$$\" >&2; "
            + "IFS= read -r executor_ready || exit 1; [ \"$executor_ready\" = START ] || exit 1; "
            + "( \"$1\" -c \"$2\" </dev/null 2>&1; executor_code=$?; printf 'EXIT %s\\n' \"$executor_code\" >&2 ) & "
            + "exec 1>&-; while IFS= read -r executor_action; do "
            + "case \"$executor_action\" in STOP) break;; FINISH) wait; exit 0;; esac; done; "
            + "kill -KILL -\"$$\"";
}
