package dev.executor.android;

import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import dev.executor.core.ShellRuntime;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/** 使用 Android 自带 toybox、sh 和系统进程 API，不附带本地二进制库。 */
public final class AndroidShell implements ShellRuntime {
    @Override public String runtime() { return "android"; }
    @Override public String platform() { return "android"; }

    @Override public Process start(String command, File directory) throws IOException {
        ProcessBuilder builder = new ProcessBuilder("/system/bin/toybox", "setsid", "/system/bin/sh", "-c",
                START_SCRIPT, "executor-task", "/system/bin/sh", command);
        builder.directory(directory).redirectErrorStream(true);
        builder.environment().keySet().removeIf(key -> key.startsWith("LOCAL_EXECUTOR_"));
        return builder.start();
    }

    @Override public void verifyGroup(int pid) throws IOException {
        // getpgid 不属于 Android 公共 SDK；读取当前用户子进程的 proc 信息，避免反射隐藏 API。
        if (pid <= 1) throw new IOException("Invalid shell process id");
        String stat = new String(Files.readAllBytes(new File("/proc/" + pid + "/stat").toPath()), StandardCharsets.UTF_8);
        int end = stat.lastIndexOf(')');
        String[] fields = end < 0 ? new String[0] : stat.substring(end + 1).trim().split("\\s+");
        if (fields.length < 3 || !fields[2].equals(Integer.toString(pid))) throw new IOException("Shell did not create an independent process group");
    }

    @Override public void killGroup(int pid) throws IOException {
        if (pid <= 1) throw new IOException("Invalid process group");
        try { Os.kill(-pid, OsConstants.SIGKILL); }
        catch (ErrnoException failure) { if (failure.errno != OsConstants.ESRCH) throw new IOException("Cannot stop shell process group", failure); }
    }
}
