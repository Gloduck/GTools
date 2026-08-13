package cn.gloduck.api.entity.model.ssh;

import cn.gloduck.api.exceptions.ApiError;

public class SshWebSocketEvent {
    public String type;

    public String connectionId;

    public String data;

    public String message;

    public SshConnectionInfo connection;

    public static SshWebSocketEvent connected(SshConnectionInfo connection) {
        SshWebSocketEvent event = new SshWebSocketEvent();
        event.type = "connected";
        event.connectionId = connection.id;
        event.connection = connection;
        return event;
    }

    public static SshWebSocketEvent output(String connectionId, String data) {
        SshWebSocketEvent event = new SshWebSocketEvent();
        event.type = "output";
        event.connectionId = connectionId;
        event.data = data;
        return event;
    }

    public static SshWebSocketEvent error(ApiError error) {
        SshWebSocketEvent event = new SshWebSocketEvent();
        event.type = "error";
        event.message = error.name();
        return event;
    }

    public static SshWebSocketEvent heartbeat(String connectionId) {
        SshWebSocketEvent event = new SshWebSocketEvent();
        event.type = "heartbeat";
        event.connectionId = connectionId;
        return event;
    }

    public static SshWebSocketEvent closed(String connectionId) {
        SshWebSocketEvent event = new SshWebSocketEvent();
        event.type = "closed";
        event.connectionId = connectionId;
        return event;
    }

    public static SshWebSocketEvent closed(String connectionId, ApiError error) {
        SshWebSocketEvent event = closed(connectionId);
        event.message = error.name();
        return event;
    }
}
