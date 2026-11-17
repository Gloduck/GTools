package dev.executor.core;

import java.util.Locale;

/** 仅翻译执行器日志，命令输出、错误原文及协议状态不参与翻译。 */
public final class LogMessages {
    private final boolean chinese;

    public LogMessages(String language) {
        if (!"zh-CN".equals(language) && !"en-US".equals(language)) throw new IllegalArgumentException("Language must be zh-CN or en-US");
        chinese = "zh-CN".equals(language);
    }

    public String text(String zh, String en, Object... args) {
        return String.format(Locale.ROOT, chinese ? zh : en, args);
    }

    public String status(String value) {
        if (!chinese) return value;
        switch (value) {
            case "running": return "运行中";
            case "completed": return "已完成";
            case "failed": return "失败";
            case "cancelled": return "已取消";
            case "unknown": return "未知";
            default: return value;
        }
    }
}
