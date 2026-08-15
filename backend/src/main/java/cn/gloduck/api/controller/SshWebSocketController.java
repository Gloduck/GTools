package cn.gloduck.api.controller;

import cn.gloduck.api.entity.model.ssh.SshConnectionInfo;
import cn.gloduck.api.entity.model.ssh.SshWebSocketEvent;
import cn.gloduck.api.entity.model.ssh.SshWebSocketMessage;
import cn.gloduck.api.exceptions.ApiError;
import cn.gloduck.api.exceptions.ApiException;
import cn.gloduck.api.service.ssh.SshService;
import cn.gloduck.api.utils.JsonUtils;
import jakarta.inject.Inject;
import jakarta.websocket.CloseReason;
import jakarta.websocket.OnClose;
import jakarta.websocket.OnError;
import jakarta.websocket.OnMessage;
import jakarta.websocket.OnOpen;
import jakarta.websocket.Session;
import jakarta.websocket.server.ServerEndpoint;

import java.io.IOException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.logging.Level;
import java.util.logging.Logger;

@ServerEndpoint("/api/ssh/ws")
public class SshWebSocketController {
    private static final Logger LOGGER = Logger.getLogger(SshWebSocketController.class.getName());

    // Jakarta WebSocket 通过无参构造创建端点实例，因此这里保留 CDI 字段注入。
    @Inject
    SshService sshService;

    private Session webSocketSession;
    private volatile String connectionId;

    @OnOpen
    public void onOpen(Session session) throws IOException {
        this.webSocketSession = session;
        try {
            sshService.verify(queryValue(session.getQueryString(), "securityKey"));
        } catch (Exception e) {
            LOGGER.log(Level.WARNING, "SSH WebSocket authentication failed: {0}", e.getMessage());
            session.close(new CloseReason(CloseReason.CloseCodes.VIOLATED_POLICY, errorOf(e).name()));
        }
    }

    @OnMessage
    public void onMessage(String text) {
        try {
            SshWebSocketMessage message = JsonUtils.readValue(text, SshWebSocketMessage.class);
            String type = message.type == null ? "" : message.type;
            if (connectionId == null) {
                if (!"connect".equalsIgnoreCase(type)) {
                    send(SshWebSocketEvent.error(ApiError.SSH_CONNECT_REQUIRED));
                    return;
                }
                SshConnectionInfo info = sshService.connect(
                        message,
                        (id, data) -> send(SshWebSocketEvent.output(id, data)),
                        this::closeByService
                );
                connectionId = info.id;
                send(SshWebSocketEvent.connected(info));
                return;
            }

            if ("input".equalsIgnoreCase(type)) {
                sshService.input(connectionId, message.data);
            } else if ("resize".equalsIgnoreCase(type)) {
                sshService.resize(connectionId, message.cols, message.rows);
            } else if ("heartbeat".equalsIgnoreCase(type)) {
                sshService.heartbeat(connectionId);
                send(SshWebSocketEvent.heartbeat(connectionId));
            } else if ("close".equalsIgnoreCase(type)) {
                closeCurrent();
            } else {
                send(SshWebSocketEvent.error(ApiError.SSH_MESSAGE_TYPE_UNSUPPORTED));
            }
        } catch (Exception e) {
            LOGGER.log(Level.WARNING, "SSH WebSocket message failed", e);
            send(SshWebSocketEvent.error(errorOf(e)));
        }
    }

    @OnClose
    public void onClose() {
        if (connectionId != null) {
            sshService.close(connectionId);
            connectionId = null;
        }
    }

    @OnError
    public void onError(Throwable throwable) {
        LOGGER.log(Level.WARNING, "SSH WebSocket failed", throwable);
        onClose();
    }

    private void closeByService(ApiError error) {
        String id = connectionId;
        connectionId = null;
        send(SshWebSocketEvent.closed(id, error));
        Session session = webSocketSession;
        if (session != null && session.isOpen()) {
            try {
                session.close(new CloseReason(CloseReason.CloseCodes.NORMAL_CLOSURE, error.name()));
            } catch (IOException ignored) {
            }
        }
    }

    private void closeCurrent() throws IOException {
        String id = connectionId;
        if (id != null) {
            sshService.close(id);
            connectionId = null;
            send(SshWebSocketEvent.closed(id));
        }
        if (webSocketSession != null && webSocketSession.isOpen()) {
            webSocketSession.close();
        }
    }

    private void send(SshWebSocketEvent event) {
        Session session = webSocketSession;
        if (session == null || !session.isOpen()) {
            return;
        }
        try {
            session.getAsyncRemote().sendText(JsonUtils.writeValueAsString(event));
        } catch (Exception ignored) {
        }
    }

    private String queryValue(String query, String key) {
        if (query == null || query.isBlank()) {
            return null;
        }
        String[] parts = query.split("&");
        for (String part : parts) {
            int index = part.indexOf('=');
            String name = index < 0 ? part : part.substring(0, index);
            if (key.equals(urlDecode(name))) {
                return index < 0 ? "" : urlDecode(part.substring(index + 1));
            }
        }
        return null;
    }

    private String urlDecode(String value) {
        return URLDecoder.decode(value, StandardCharsets.UTF_8);
    }

    private ApiError errorOf(Exception exception) {
        return exception instanceof ApiException apiException
                ? apiException.getError()
                : ApiError.SSH_MESSAGE_INVALID;
    }

}
