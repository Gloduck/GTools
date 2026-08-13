package cn.gloduck.api.service.ssh;

import cn.gloduck.api.entity.model.ssh.SshConnectionInfo;
import cn.gloduck.api.exceptions.ApiError;
import com.jcraft.jsch.ChannelShell;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.function.Consumer;

class SshConnection {
    private final String id;
    private final String name;
    private final String host;
    private final Integer port;
    private final String username;
    private final long createdAt;
    private final com.jcraft.jsch.Session sshSession;
    private final ChannelShell channel;
    private final Consumer<ApiError> closeCallback;

    private volatile long lastActiveAt;
    private volatile long lastHeartbeatAt;
    private volatile OutputStream inputStream;

    SshConnection(String id,
                  String name,
                  String host,
                  Integer port,
                  String username,
                  com.jcraft.jsch.Session sshSession,
                  ChannelShell channel,
                  Consumer<ApiError> closeCallback) {
        this.id = id;
        this.name = name;
        this.host = host;
        this.port = port;
        this.username = username;
        this.sshSession = sshSession;
        this.channel = channel;
        this.closeCallback = closeCallback;
        this.createdAt = System.currentTimeMillis();
        this.lastActiveAt = createdAt;
        this.lastHeartbeatAt = createdAt;
    }

    String id() {
        return id;
    }

    void setInputStream(OutputStream inputStream) {
        this.inputStream = inputStream;
    }

    void write(String data) {
        if (data == null) {
            return;
        }
        OutputStream stream = inputStream;
        if (stream == null) {
            throw new IllegalStateException("SSH input stream is not ready");
        }
        try {
            synchronized (stream) {
                stream.write(data.getBytes(StandardCharsets.UTF_8));
                stream.flush();
            }
            lastActiveAt = System.currentTimeMillis();
        } catch (IOException e) {
            throw new IllegalStateException("Failed to write ssh input", e);
        }
    }

    void resize(Integer cols, Integer rows) {
        if (cols == null || rows == null || cols <= 0 || rows <= 0 || channel == null || !channel.isConnected()) {
            return;
        }
        channel.setPtySize(cols, rows, cols * 8, rows * 16);
        lastActiveAt = System.currentTimeMillis();
    }

    void markOutput() {
        lastActiveAt = System.currentTimeMillis();
    }

    void heartbeat() {
        lastHeartbeatAt = System.currentTimeMillis();
    }

    boolean isHeartbeatTimedOut(long timeoutMillis) {
        return timeoutMillis > 0 && System.currentTimeMillis() - lastHeartbeatAt > timeoutMillis;
    }

    void notifyClosed(ApiError error) {
        if (closeCallback != null) {
            closeCallback.accept(error);
        }
    }

    SshConnectionInfo info() {
        SshConnectionInfo info = new SshConnectionInfo();
        info.id = id;
        info.name = name;
        info.host = host;
        info.port = port;
        info.username = username;
        info.connected = isConnected();
        info.createdAt = createdAt;
        info.lastActiveAt = lastActiveAt;
        return info;
    }

    boolean isConnected() {
        return sshSession != null && sshSession.isConnected() && channel != null && channel.isConnected();
    }

    void close() {
        try {
            if (channel != null) {
                channel.disconnect();
            }
        } finally {
            if (sshSession != null) {
                sshSession.disconnect();
            }
        }
    }
}
