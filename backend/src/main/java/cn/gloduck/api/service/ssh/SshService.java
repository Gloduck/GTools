package cn.gloduck.api.service.ssh;

import cn.gloduck.api.entity.config.SshConfig;
import cn.gloduck.api.entity.model.ssh.SshConnectRequest;
import cn.gloduck.api.entity.model.ssh.SshConnectionInfo;
import cn.gloduck.api.entity.model.ssh.SftpTransferResult;
import cn.gloduck.api.exceptions.ApiError;
import cn.gloduck.api.exceptions.ApiException;
import cn.gloduck.api.utils.StringUtils;
import com.jcraft.jsch.ChannelSftp;
import com.jcraft.jsch.ChannelShell;
import com.jcraft.jsch.JSch;
import com.jcraft.jsch.SftpATTRS;
import com.jcraft.jsch.SftpException;
import com.jcraft.jsch.UIKeyboardInteractive;
import com.jcraft.jsch.UserInfo;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import jakarta.enterprise.context.ApplicationScoped;

import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.function.BiConsumer;
import java.util.function.Consumer;

@ApplicationScoped
public class SshService {
    private static final int DEFAULT_MAX_CONNECTIONS = 10;
    private static final int DEFAULT_HEARTBEAT_TIMEOUT_SECONDS = 60;
    private static final int CONNECT_TIMEOUT_MILLIS = 10_000;

    private final SshConfig sshConfig;
    private final Map<String, SshConnection> connections = new ConcurrentHashMap<>();
    private final Object connectionLimitLock = new Object();
    private ScheduledExecutorService cleanupExecutor;

    public SshService(SshConfig sshConfig) {
        this.sshConfig = sshConfig;
    }

    public void verify(String securityKey) {
        String configuredSecurityKey = sshConfig == null ? null : sshConfig.securityKey;
        if (StringUtils.isNullOrEmpty(configuredSecurityKey)) {
            return;
        }
        if (!configuredSecurityKey.equals(securityKey)) {
            throw new ApiException(ApiError.SSH_SECURITY_KEY_INVALID);
        }
    }

    @PostConstruct
    void init() {
        applyJschConfig();
        cleanupExecutor = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread thread = new Thread(r, "ssh-heartbeat-cleaner");
            thread.setDaemon(true);
            return thread;
        });
        cleanupExecutor.scheduleWithFixedDelay(this::cleanupConnections, 5, 5, TimeUnit.SECONDS);
    }

    @PreDestroy
    void destroy() {
        if (cleanupExecutor != null) {
            cleanupExecutor.shutdownNow();
        }
        for (String connectionId : connections.keySet()) {
            close(connectionId);
        }
    }

    public SshConnectionInfo connect(SshConnectRequest request, BiConsumer<String, String> outputConsumer, Consumer<ApiError> closeCallback) {
        validate(request);
        ensureConnectionCapacity();

        String id = UUID.randomUUID().toString();
        com.jcraft.jsch.Session sshSession = null;
        ChannelShell channel = null;
        try {
            int port = request.port == null ? 22 : request.port;
            sshSession = createSession(request, id);

            channel = (ChannelShell) sshSession.openChannel("shell");
            channel.setPty(true);
            channel.setPtyType("xterm-256color");
            if (validSize(request.cols, request.rows)) {
                channel.setPtySize(request.cols, request.rows, request.cols * 8, request.rows * 16);
            }

            SshConnection connection = new SshConnection(
                    id,
                    request.name,
                    request.host,
                    port,
                    request.username,
                    sshSession,
                    channel,
                    closeCallback
            );
            OutputStream sshOutput = new ForwardingOutputStream(data -> {
                connection.markOutput();
                if (outputConsumer != null) {
                    outputConsumer.accept(id, data);
                }
            });
            channel.setOutputStream(sshOutput, true);
            channel.setExtOutputStream(sshOutput, true);
            connection.setInputStream(channel.getOutputStream());
            channel.connect(CONNECT_TIMEOUT_MILLIS);
            putConnection(connection);
            return connection.info();
        } catch (ApiException e) {
            if (channel != null) {
                channel.disconnect();
            }
            if (sshSession != null) {
                sshSession.disconnect();
            }
            throw e;
        } catch (Exception e) {
            if (channel != null) {
                channel.disconnect();
            }
            if (sshSession != null) {
                sshSession.disconnect();
            }
            throw new ApiException(ApiError.SSH_CONNECT_FAILED, e);
        }
    }

    public SftpTransferResult uploadSftp(SshConnectRequest request, String remotePath, boolean createDirs, InputStream input) {
        validate(request);
        validateRemotePath(remotePath);
        if (input == null) {
            throw new ApiException(ApiError.SFTP_REQUEST_INVALID);
        }

        com.jcraft.jsch.Session session = null;
        ChannelSftp sftp = null;
        boolean renamed = false;
        String tempPath = null;
        try {
            session = createSession(request, UUID.randomUUID().toString());
            sftp = openSftp(session);
            String resolvedRemotePath = resolveRemotePath(sftp, remotePath);
            tempPath = resolvedRemotePath + ".uploading-" + UUID.randomUUID();
            if (createDirs) {
                ensureRemoteDirectory(sftp, parentPath(resolvedRemotePath));
            }

            CountingInputStream countingInput = new CountingInputStream(input);
            sftp.put(countingInput, tempPath);
            renameUploadedFile(sftp, tempPath, resolvedRemotePath);
            renamed = true;
            return new SftpTransferResult(resolvedRemotePath, countingInput.count(), "uploaded");
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            throw new ApiException(ApiError.SFTP_UPLOAD_FAILED, e);
        } finally {
            boolean deletedTemp = renamed || deleteQuietly(sftp, tempPath);
            closeSftp(sftp, session);
            if (!deletedTemp) {
                deleteSftpPathWithNewSession(request, tempPath);
            }
        }
    }

    public SftpDownload openSftpDownload(SshConnectRequest request, String remotePath) {
        validate(request);
        validateRemotePath(remotePath);

        com.jcraft.jsch.Session session = null;
        ChannelSftp sftp = null;
        try {
            session = createSession(request, UUID.randomUUID().toString());
            sftp = openSftp(session);
            String resolvedRemotePath = resolveRemotePath(sftp, remotePath);
            SftpATTRS attrs = sftp.lstat(resolvedRemotePath);
            if (attrs.isDir()) {
                throw new ApiException(ApiError.SFTP_REMOTE_PATH_INVALID);
            }
            return new SftpDownload(session, sftp, resolvedRemotePath, attrs.getSize());
        } catch (ApiException e) {
            closeSftp(sftp, session);
            throw e;
        } catch (Exception e) {
            closeSftp(sftp, session);
            throw new ApiException(ApiError.SFTP_DOWNLOAD_FAILED, e);
        }
    }

    public void heartbeat(String connectionId) {
        connection(connectionId).heartbeat();
    }

    public void input(String connectionId, String data) {
        SshConnection connection = connection(connectionId);
        connection.write(data);
    }

    public void resize(String connectionId, Integer cols, Integer rows) {
        connection(connectionId).resize(cols, rows);
    }

    public void close(String connectionId) {
        if (connectionId == null) {
            return;
        }
        SshConnection connection = connections.remove(connectionId);
        if (connection != null) {
            connection.close();
        }
    }

    private void putConnection(SshConnection connection) {
        synchronized (connectionLimitLock) {
            ensureConnectionCapacityLocked();
            connections.put(connection.id(), connection);
        }
    }

    private void ensureConnectionCapacity() {
        synchronized (connectionLimitLock) {
            ensureConnectionCapacityLocked();
        }
    }

    private void ensureConnectionCapacityLocked() {
        cleanupConnections();
        int maxConnections = maxConnections();
        if (maxConnections > 0 && connections.size() >= maxConnections) {
            throw new ApiException(ApiError.SSH_CONNECTION_LIMIT_EXCEEDED);
        }
    }

    private void cleanupConnections() {
        long timeoutMillis = heartbeatTimeoutMillis();
        for (Map.Entry<String, SshConnection> entry : connections.entrySet()) {
            SshConnection connection = entry.getValue();
            if (connection == null || !connection.isConnected()) {
                if (connections.remove(entry.getKey(), connection) && connection != null) {
                    connection.close();
                    connection.notifyClosed(ApiError.SSH_CONNECTION_DISCONNECTED);
                }
            } else if (timeoutMillis > 0 && connection.isHeartbeatTimedOut(timeoutMillis) && connections.remove(entry.getKey(), connection)) {
                connection.close();
                connection.notifyClosed(ApiError.SSH_HEARTBEAT_TIMEOUT);
            }
        }
    }

    private SshConnection connection(String connectionId) {
        if (StringUtils.isNullOrEmpty(connectionId)) {
            throw new ApiException(ApiError.SSH_CONNECTION_UNAVAILABLE);
        }
        SshConnection connection = connections.get(connectionId);
        if (connection == null || !connection.isConnected()) {
            connections.remove(connectionId);
            throw new ApiException(ApiError.SSH_CONNECTION_UNAVAILABLE);
        }
        return connection;
    }

    private com.jcraft.jsch.Session createSession(SshConnectRequest request, String identitySuffix) throws Exception {
        JSch jsch = new JSch();
        boolean privateKeyAuth = isPrivateKeyAuth(request.authType);
        if (privateKeyAuth) {
            byte[] keyBytes = request.privateKey.getBytes(StandardCharsets.UTF_8);
            byte[] passphraseBytes = StringUtils.isNullOrEmpty(request.passphrase) ? null : request.passphrase.getBytes(StandardCharsets.UTF_8);
            jsch.addIdentity("ssh-key-" + identitySuffix, keyBytes, null, passphraseBytes);
        }

        int port = request.port == null ? 22 : request.port;
        com.jcraft.jsch.Session session = jsch.getSession(request.username, request.host, port);
        session.setConfig(sessionConfig(privateKeyAuth));
        if (!privateKeyAuth) {
            session.setPassword(request.password);
        }
        session.setUserInfo(new PasswordUserInfo(request.password, request.passphrase));
        session.connect(CONNECT_TIMEOUT_MILLIS);
        return session;
    }

    private ChannelSftp openSftp(com.jcraft.jsch.Session session) throws Exception {
        ChannelSftp sftp = (ChannelSftp) session.openChannel("sftp");
        sftp.connect(CONNECT_TIMEOUT_MILLIS);
        return sftp;
    }

    private void validateRemotePath(String remotePath) {
        if (StringUtils.isNullOrEmpty(remotePath) || remotePath.isBlank()) {
            throw new ApiException(ApiError.SFTP_REMOTE_PATH_INVALID);
        }
        if (remotePath.endsWith("/")) {
            throw new ApiException(ApiError.SFTP_REMOTE_PATH_INVALID);
        }
    }

    private String resolveRemotePath(ChannelSftp sftp, String remotePath) throws SftpException {
        String normalized = remotePath.trim().replace('\\', '/');
        if ("~".equals(normalized)) {
            return sftp.getHome();
        }
        if (normalized.startsWith("~/")) {
            return sftp.getHome() + normalized.substring(1);
        }
        return normalized;
    }

    private void ensureRemoteDirectory(ChannelSftp sftp, String directory) throws SftpException {
        if (StringUtils.isNullOrEmpty(directory) || ".".equals(directory)) {
            return;
        }
        String normalized = directory.replace('\\', '/');
        String[] parts = normalized.split("/");
        String current = normalized.startsWith("/") ? "/" : "";
        for (String part : parts) {
            if (part == null || part.isBlank() || ".".equals(part)) {
                continue;
            }
            current = "/".equals(current) ? current + part : (current.isEmpty() ? part : current + "/" + part);
            try {
                SftpATTRS attrs = sftp.lstat(current);
                if (!attrs.isDir()) {
                    throw new ApiException(ApiError.SFTP_REMOTE_PATH_INVALID);
                }
            } catch (SftpException e) {
                if (e.id != ChannelSftp.SSH_FX_NO_SUCH_FILE) {
                    throw e;
                }
                sftp.mkdir(current);
            }
        }
    }

    private String parentPath(String remotePath) {
        String normalized = remotePath.replace('\\', '/');
        int index = normalized.lastIndexOf('/');
        if (index < 0) {
            return ".";
        }
        if (index == 0) {
            return "/";
        }
        return normalized.substring(0, index);
    }

    private void renameUploadedFile(ChannelSftp sftp, String tempPath, String remotePath) throws SftpException {
        try {
            sftp.rename(tempPath, remotePath);
        } catch (SftpException firstError) {
            deleteQuietly(sftp, remotePath);
            sftp.rename(tempPath, remotePath);
        }
    }

    private boolean deleteQuietly(ChannelSftp sftp, String path) {
        if (sftp == null || StringUtils.isNullOrEmpty(path)) {
            return false;
        }
        try {
            sftp.rm(path);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private void deleteSftpPathWithNewSession(SshConnectRequest request, String path) {
        com.jcraft.jsch.Session cleanupSession = null;
        ChannelSftp cleanupSftp = null;
        try {
            cleanupSession = createSession(request, UUID.randomUUID().toString());
            cleanupSftp = openSftp(cleanupSession);
            deleteQuietly(cleanupSftp, path);
        } catch (Exception ignored) {
        } finally {
            closeSftp(cleanupSftp, cleanupSession);
        }
    }

    private void closeSftp(ChannelSftp sftp, com.jcraft.jsch.Session session) {
        try {
            if (sftp != null) {
                sftp.disconnect();
            }
        } finally {
            if (session != null) {
                session.disconnect();
            }
        }
    }

    private void validate(SshConnectRequest request) {
        if (request == null) {
            throw new ApiException(ApiError.SSH_CONNECT_REQUEST_INVALID);
        }
        if (StringUtils.isNullOrEmpty(request.host)) {
            throw new ApiException(ApiError.SSH_CONNECT_REQUEST_INVALID);
        }
        if (StringUtils.isNullOrEmpty(request.username)) {
            throw new ApiException(ApiError.SSH_CONNECT_REQUEST_INVALID);
        }
        if (request.port != null && (request.port <= 0 || request.port > 65535)) {
            throw new ApiException(ApiError.SSH_CONNECT_REQUEST_INVALID);
        }
        if (isPrivateKeyAuth(request.authType)) {
            if (StringUtils.isNullOrEmpty(request.privateKey)) {
                throw new ApiException(ApiError.SSH_CONNECT_REQUEST_INVALID);
            }
        } else if (StringUtils.isNullOrEmpty(request.password)) {
            throw new ApiException(ApiError.SSH_CONNECT_REQUEST_INVALID);
        }
    }

    private Properties sessionConfig(boolean privateKeyAuth) {
        Properties properties = new Properties();
        properties.put("StrictHostKeyChecking", "no");
        properties.put("ServerAliveInterval", "30000");
        properties.put("ServerAliveCountMax", "3");
        properties.put("PreferredAuthentications", privateKeyAuth ? "publickey,password,keyboard-interactive" : "password,keyboard-interactive");
        return properties;
    }

    private void applyJschConfig() {
        String kex = String.join(",",
                "curve25519-sha256",
                "curve25519-sha256@libssh.org",
                "ecdh-sha2-nistp256",
                "ecdh-sha2-nistp384",
                "ecdh-sha2-nistp521",
                "diffie-hellman-group-exchange-sha256",
                "diffie-hellman-group16-sha512",
                "diffie-hellman-group18-sha512",
                "diffie-hellman-group14-sha256"
        );
        String hostKeys = String.join(",",
                "ssh-ed25519",
                "ssh-ed448",
                "ecdsa-sha2-nistp256",
                "ecdsa-sha2-nistp384",
                "ecdsa-sha2-nistp521",
                "rsa-sha2-512",
                "rsa-sha2-256"
        );
        String ciphers = String.join(",",
                "aes128-ctr",
                "aes192-ctr",
                "aes256-ctr",
                "aes128-gcm@openssh.com",
                "aes256-gcm@openssh.com"
        );
        String macs = String.join(",",
                "hmac-sha2-256",
                "hmac-sha2-512",
                "hmac-sha2-256-etm@openssh.com",
                "hmac-sha2-512-etm@openssh.com",
                "hmac-sha1",
                "hmac-sha1-etm@openssh.com"
        );

        JSch.setConfig("kex", kex);
        JSch.setConfig("server_host_key", hostKeys);
        JSch.setConfig("PubkeyAcceptedAlgorithms", hostKeys);
        JSch.setConfig("cipher.c2s", ciphers);
        JSch.setConfig("cipher.s2c", ciphers);
        JSch.setConfig("mac.c2s", macs);
        JSch.setConfig("mac.s2c", macs);
        JSch.setConfig("compression.c2s", "none,zlib@openssh.com,zlib");
        JSch.setConfig("compression.s2c", "none,zlib@openssh.com,zlib");
    }

    private int maxConnections() {
        Integer value = sshConfig == null ? null : sshConfig.maxConnections;
        return value == null ? DEFAULT_MAX_CONNECTIONS : value;
    }

    private long heartbeatTimeoutMillis() {
        Integer value = sshConfig == null ? null : sshConfig.heartbeatTimeoutSeconds;
        int seconds = value == null ? DEFAULT_HEARTBEAT_TIMEOUT_SECONDS : value;
        return seconds <= 0 ? 0 : seconds * 1000L;
    }

    private boolean validSize(Integer cols, Integer rows) {
        return cols != null && rows != null && cols > 0 && rows > 0;
    }

    private boolean isPrivateKeyAuth(String authType) {
        return "privateKey".equalsIgnoreCase(authType) || "key".equalsIgnoreCase(authType) || "sshKey".equalsIgnoreCase(authType);
    }

    public class SftpDownload implements AutoCloseable {
        private final com.jcraft.jsch.Session session;
        private final ChannelSftp sftp;
        private final String remotePath;
        private final long size;

        private SftpDownload(com.jcraft.jsch.Session session, ChannelSftp sftp, String remotePath, long size) {
            this.session = session;
            this.sftp = sftp;
            this.remotePath = remotePath;
            this.size = size;
        }

        public String remotePath() {
            return remotePath;
        }

        public long size() {
            return size;
        }

        public void writeTo(OutputStream output) throws IOException {
            try (InputStream input = sftp.get(remotePath)) {
                input.transferTo(output);
                output.flush();
            } catch (SftpException e) {
                throw new IOException("SFTP read failed: " + e.getMessage(), e);
            } finally {
                close();
            }
        }

        @Override
        public void close() {
            closeSftp(sftp, session);
        }
    }

    private static class CountingInputStream extends FilterInputStream {
        private long count;

        private CountingInputStream(InputStream in) {
            super(in);
        }

        long count() {
            return count;
        }

        @Override
        public int read() throws IOException {
            int value = super.read();
            if (value >= 0) {
                count += 1;
            }
            return value;
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
            int value = super.read(b, off, len);
            if (value > 0) {
                count += value;
            }
            return value;
        }
    }

    private static class ForwardingOutputStream extends OutputStream {
        private final Consumer<String> consumer;

        private ForwardingOutputStream(Consumer<String> consumer) {
            this.consumer = consumer;
        }

        @Override
        public void write(int b) {
            consumer.accept(new String(new byte[]{(byte) b}, StandardCharsets.UTF_8));
        }

        @Override
        public void write(byte[] b, int off, int len) {
            consumer.accept(new String(b, off, len, StandardCharsets.UTF_8));
        }
    }

    private static class PasswordUserInfo implements UserInfo, UIKeyboardInteractive {
        private final String password;
        private final String passphrase;

        private PasswordUserInfo(String password, String passphrase) {
            this.password = password;
            this.passphrase = passphrase;
        }

        @Override
        public String getPassphrase() {
            return passphrase;
        }

        @Override
        public String getPassword() {
            return password;
        }

        @Override
        public boolean promptPassword(String message) {
            return password != null;
        }

        @Override
        public boolean promptPassphrase(String message) {
            return passphrase != null;
        }

        @Override
        public boolean promptYesNo(String message) {
            return true;
        }

        @Override
        public void showMessage(String message) {
        }

        @Override
        public String[] promptKeyboardInteractive(String destination, String name, String instruction, String[] prompt, boolean[] echo) {
            if (password == null || prompt == null) {
                return null;
            }
            String[] values = new String[prompt.length];
            for (int i = 0; i < values.length; i++) {
                values[i] = password;
            }
            return values;
        }
    }
}
