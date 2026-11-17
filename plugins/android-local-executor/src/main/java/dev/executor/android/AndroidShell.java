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
        builder.directory(directory).redirectErrorStream(false);
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

    @Override public boolean hasBusinessProcesses(int group) throws IOException {
        File[] entries = new File("/proc").listFiles();
        if (entries == null) throw new IOException("Cannot inspect task process group");
        for (File entry : entries) {
            if (!entry.getName().matches("[0-9]+") || entry.getName().equals(Integer.toString(group))) continue;
            String stat;
            try { stat = new String(Files.readAllBytes(new File(entry, "stat").toPath()), StandardCharsets.UTF_8); }
            catch (IOException failure) {
                try {
                    if (Os.stat(entry.getPath()).st_uid == Os.getuid()) throw failure;
                } catch (ErrnoException missing) {
                    if (missing.errno != OsConstants.ENOENT && missing.errno != OsConstants.ESRCH) throw new IOException("Cannot inspect task process ownership", missing);
                }
                continue; // 已退出或属于其他用户的不可读记录不参与本任务判断。
            }
            int end = stat.lastIndexOf(')');
            String[] fields = end < 0 ? new String[0] : stat.substring(end + 1).trim().split("\\s+");
            if (fields.length >= 3 && fields[2].equals(Integer.toString(group)) && !fields[0].equals("Z") && !fields[0].equals("X")) return true;
        }
        return false;
    }
}
