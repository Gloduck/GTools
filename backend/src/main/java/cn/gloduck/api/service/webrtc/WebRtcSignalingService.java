package cn.gloduck.api.service.webrtc;

import cn.gloduck.api.entity.config.WebRtcConfig;
import cn.gloduck.api.entity.config.WebRtcIceServerConfig;
import cn.gloduck.api.entity.model.webrtc.WebRtcCloseSessionResponse;
import cn.gloduck.api.entity.model.webrtc.WebRtcConfigResponse;
import cn.gloduck.api.entity.model.webrtc.WebRtcCreateSessionRequest;
import cn.gloduck.api.entity.model.webrtc.WebRtcJoinSessionRequest;
import cn.gloduck.api.entity.model.webrtc.WebRtcKeyConstraints;
import cn.gloduck.api.entity.model.webrtc.WebRtcLeaveResponse;
import cn.gloduck.api.entity.model.webrtc.WebRtcOutgoingEvent;
import cn.gloduck.api.entity.model.webrtc.WebRtcParticipantInfo;
import cn.gloduck.api.entity.model.webrtc.WebRtcParticipantRequest;
import cn.gloduck.api.entity.model.webrtc.WebRtcRejectedEvent;
import cn.gloduck.api.entity.model.webrtc.WebRtcSessionConnectionResponse;
import cn.gloduck.api.entity.model.webrtc.WebRtcSessionInfo;
import cn.gloduck.api.entity.model.webrtc.WebRtcSignalEvent;
import cn.gloduck.api.entity.model.webrtc.WebRtcSyncRequest;
import cn.gloduck.api.entity.model.webrtc.WebRtcSyncResponse;
import cn.gloduck.api.exceptions.ApiError;
import cn.gloduck.api.exceptions.ApiException;
import cn.gloduck.api.utils.JsonUtils;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import jakarta.enterprise.context.ApplicationScoped;
import org.jboss.logging.Logger;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Pattern;

/**
 * 基于进程内存的 WebRTC 信令服务，后端只转发协商事件，不接触文件内容。
 *
 * <p>两个 ConcurrentMap 只负责并发定位会话；会话及其参与者的可变状态统一由
 * {@code synchronized (session)} 保护。名称以 {@code Locked} 结尾的方法要求调用方已持有该锁。</p>
 */
@ApplicationScoped
public class WebRtcSignalingService {
    private static final Logger LOG = Logger.getLogger(WebRtcSignalingService.class);
    private static final String SESSION_KEY_PATTERN_TEXT = "^[A-Za-z0-9_-]+$";
    private static final Pattern SESSION_KEY_PATTERN = Pattern.compile(SESSION_KEY_PATTERN_TEXT);
    private static final Pattern APPLICATION_PATTERN = Pattern.compile("^[A-Za-z0-9._-]+$");
    private static final Pattern EVENT_TYPE_PATTERN = Pattern.compile("^[A-Za-z0-9._-]+$");
    private static final int PROTOCOL_VERSION = 1;
    private static final String OWNER = "OWNER";
    private static final String MEMBER = "MEMBER";
    private static final String WAITING = "WAITING";
    private static final String ACTIVE = "ACTIVE";
    private static final String CLOSED = "CLOSED";
    private static final int SECRET_BYTES = 32;
    private static final int MAX_TEXT_FIELD_LENGTH = 128;
    private static final int MAX_APPLICATION_LENGTH = 64;
    private static final int MAX_CAPABILITIES = 32;
    private static final int MAX_CAPABILITY_LENGTH = 64;
    private static final int SESSION_KEY_MIN_LENGTH = 6;
    private static final int SESSION_KEY_MAX_LENGTH = 128;
    private static final int PARTICIPANT_KEY_MIN_LENGTH = 22;
    private static final int PARTICIPANT_KEY_MAX_LENGTH = 128;

    /** 锁外完成校验和 payload 复制后的客户端出站事件。 */
    private record PreparedOutgoingEvent(String eventId,
                                         boolean eventIdValid,
                                         String type,
                                         String targetParticipantId,
                                         String negotiationId,
                                         JsonNode payload,
                                         int payloadBytes,
                                         String rejectionCode,
                                         String rejectionMessage) {
    }

    private final WebRtcConfig config;
    private final ConcurrentMap<String, WebRtcSessionState> sessionsById = new ConcurrentHashMap<>();
    private final ConcurrentMap<String, WebRtcSessionState> sessionsByKeyHash = new ConcurrentHashMap<>();
    private final AtomicInteger sessionCount = new AtomicInteger();
    private final byte[] sessionKeySecret = randomSecret();
    private final byte[] participantTokenSecret = randomSecret();
    private ScheduledExecutorService cleanupExecutor;

    /** 创建信令服务并将缺失或非法的配置项规范化为安全默认值。 */
    public WebRtcSignalingService(WebRtcConfig config) {
        this.config = config == null ? new WebRtcConfig() : config;
        normalizeConfig();
    }

    /** 启动单线程定时任务，周期性清理超时的参与者和会话。 */
    @PostConstruct
    void init() {
        // 使用单独的守护线程清理过期状态，避免清理任务阻止应用退出。
        cleanupExecutor = Executors.newSingleThreadScheduledExecutor(runnable -> {
            Thread thread = new Thread(runnable, "webrtc-session-cleaner");
            thread.setDaemon(true);
            return thread;
        });
        cleanupExecutor.scheduleWithFixedDelay(
                this::cleanupSafely,
                config.cleanupIntervalMs,
                config.cleanupIntervalMs,
                TimeUnit.MILLISECONDS
        );
    }

    /** 停止清理任务并释放当前进程保存的全部信令状态。 */
    @PreDestroy
    void destroy() {
        if (cleanupExecutor != null) {
            cleanupExecutor.shutdownNow();
        }
        sessionsByKeyHash.clear();
        sessionsById.clear();
        sessionCount.set(0);
    }

    /** 构造前端建立 WebRTC 连接所需的公开协议配置。 */
    public WebRtcConfigResponse config() {
        WebRtcConfigResponse response = new WebRtcConfigResponse();
        response.protocolVersion = PROTOCOL_VERSION;
        response.participantIdleTimeoutMs = config.participantIdleTimeoutMs;
        response.sessionIdleTimeoutMs = config.sessionIdleTimeoutMs;
        response.maxSessions = config.maxSessions;
        response.maxParticipants = config.maxParticipants;
        response.maxOutgoingEventsPerSync = config.maxOutgoingEventsPerSync;
        response.maxPendingEventsPerParticipant = config.maxPendingEventsPerParticipant;
        response.maxPendingEventBytesPerParticipant = config.maxPendingEventBytesPerParticipant;
        response.maxEventPayloadBytes = config.maxEventPayloadBytes;
        response.maxMetadataBytes = config.maxMetadataBytes;
        response.sessionKeyConstraints = new WebRtcKeyConstraints();
        response.sessionKeyConstraints.minLength = SESSION_KEY_MIN_LENGTH;
        response.sessionKeyConstraints.maxLength = SESSION_KEY_MAX_LENGTH;
        response.sessionKeyConstraints.pattern = SESSION_KEY_PATTERN_TEXT;
        response.participantKeyConstraints = new WebRtcKeyConstraints();
        response.participantKeyConstraints.minLength = PARTICIPANT_KEY_MIN_LENGTH;
        response.participantKeyConstraints.maxLength = PARTICIPANT_KEY_MAX_LENGTH;
        response.participantKeyConstraints.pattern = SESSION_KEY_PATTERN_TEXT;
        response.iceServers = copyIceServers(config.iceServers);
        return response;
    }

    /** 使用前端生成的连接码创建会话，并返回创建者的连接凭证。 */
    public WebRtcSessionConnectionResponse create(WebRtcCreateSessionRequest request) {
        validateCreateRequest(request);
        String keyHash = sessionKeyHash(request.sessionKey);
        byte[] requestedClientKeyHash = clientKeyHash(request.participant.clientKey);
        while (true) {
            WebRtcSessionState existing = sessionsByKeyHash.get(keyHash);
            if (existing != null) {
                boolean retryCreate = false;
                WebRtcSessionConnectionResponse existingResponse = null;
                synchronized (existing) {
                    long now = System.currentTimeMillis();
                    if (existing.purged || existing.closed || shouldExpireLocked(existing, now)) {
                        if (!existing.closed && !existing.purged) {
                            closeSessionLocked(existing, "SESSION_EXPIRED", null, now);
                        }
                        sessionsByKeyHash.remove(keyHash, existing);
                        retryCreate = true;
                    } else {
                        WebRtcParticipantState owner = existing.participants.get(existing.ownerParticipantId);
                        // clientId 与高熵 clientKey 同时匹配时视为创建请求重试，返回原连接信息。
                        if (owner != null
                                && owner.clientId.equals(request.participant.clientId)
                                && matchesClientKey(owner, requestedClientKeyHash)
                                && existing.application.equals(request.application)
                                && existing.applicationVersion.equals(request.applicationVersion)) {
                            touchLocked(existing, owner, now);
                            existingResponse = connectionResponseLocked(existing, owner);
                        } else {
                            throw error(ApiError.WEBRTC_SESSION_KEY_CONFLICT);
                        }
                    }
                }
                if (existingResponse != null) {
                    return completeConnectionResponse(existingResponse);
                }
                if (retryCreate) {
                    continue;
                }
            }

            if (!reserveSessionSlot()) {
                throw error(ApiError.WEBRTC_SESSION_LIMIT_EXCEEDED);
            }
            long now = System.currentTimeMillis();
            WebRtcSessionState session = newSession(keyHash, request, requestedClientKeyHash, now);
            WebRtcSessionConnectionResponse response = null;
            // 清理线程通过 ID 索引发现会话后会获取同一把锁，因此两个索引不会以半发布状态被处理。
            synchronized (session) {
                if (sessionsById.putIfAbsent(session.sessionId, session) != null) {
                    releaseSessionSlot();
                    continue;
                }
                WebRtcSessionState raced = sessionsByKeyHash.putIfAbsent(keyHash, session);
                if (raced == null) {
                    response = connectionResponseLocked(session, session.participants.get(session.ownerParticipantId));
                } else {
                    session.purged = true;
                    if (sessionsById.remove(session.sessionId, session)) {
                        releaseSessionSlot();
                    }
                }
            }
            if (response != null) {
                return completeConnectionResponse(response);
            }
        }
    }

    /** 根据连接码加入已有会话，并返回加入者的连接凭证。 */
    public WebRtcSessionConnectionResponse join(WebRtcJoinSessionRequest request) {
        validateJoinRequest(request);
        WebRtcSessionState session = sessionsByKeyHash.get(sessionKeyHash(request.sessionKey));
        if (session == null) {
            throw error(ApiError.WEBRTC_SESSION_NOT_FOUND);
        }
        byte[] requestedClientKeyHash = clientKeyHash(request.participant.clientKey);
        WebRtcParticipantState joining = newParticipant(request.participant, MEMBER, requestedClientKeyHash);
        WebRtcSessionConnectionResponse response;

        synchronized (session) {
            long now = System.currentTimeMillis();
            requireAvailableSessionLocked(session);
            if (session.closed) {
                throw error(ApiError.WEBRTC_SESSION_NOT_FOUND);
            }
            if (shouldExpireLocked(session, now)) {
                closeSessionLocked(session, "SESSION_EXPIRED", null, now);
                throw error(ApiError.WEBRTC_SESSION_NOT_FOUND);
            }
            if (!session.application.equals(request.application)) {
                throw error(ApiError.WEBRTC_APPLICATION_MISMATCH);
            }
            if (!session.applicationVersion.equals(request.applicationVersion)) {
                throw error(ApiError.WEBRTC_APPLICATION_VERSION_MISMATCH);
            }

            WebRtcParticipantState existing = session.participantsByClientId.get(request.participant.clientId);
            if (existing != null) {
                // 相同 clientId 只有持有原 clientKey 才能恢复连接，防止冒充已有参与者。
                if (!matchesClientKey(existing, requestedClientKeyHash)) {
                    throw error(ApiError.WEBRTC_PARTICIPANT_ALREADY_JOINED);
                }
                touchLocked(session, existing, now);
                response = connectionResponseLocked(session, existing);
            } else {
                if (session.participants.size() >= session.maxParticipants) {
                    throw error(ApiError.WEBRTC_SESSION_FULL);
                }

                joining.joinedAt = now;
                joining.lastActivityAt = now;
                session.participants.put(joining.participantId, joining);
                session.participantsByClientId.put(joining.clientId, joining);
                session.lastActivityAt = Math.max(session.lastActivityAt, now);
                updateStateLocked(session);
                emitParticipantJoinedLocked(session, joining, now);
                response = connectionResponseLocked(session, joining);
            }
        }
        return completeConnectionResponse(response);
    }

    /** 校验参与者身份并返回当前会话快照。 */
    public WebRtcSessionInfo getSession(String sessionId, String authorization) {
        WebRtcSessionState session = requireSession(sessionId);
        String participantId = verifyParticipantToken(session.sessionId, authorization);
        WebRtcSessionInfo response;
        synchronized (session) {
            long now = System.currentTimeMillis();
            WebRtcParticipantState self = requireParticipantLocked(session, participantId);
            if (!session.closed && shouldExpireLocked(session, now)) {
                closeSessionLocked(session, "SESSION_EXPIRED", null, now);
            }
            if (!session.closed) {
                touchLocked(session, self, now);
            } else {
                self.lastActivityAt = now;
            }
            response = sessionInfoLocked(session, self);
        }
        return completeSessionInfo(response);
    }

    /** 确认已消费事件、接收出站事件并返回当前待处理信令。 */
    public WebRtcSyncResponse sync(String sessionId, String authorization, WebRtcSyncRequest request) {
        if (request == null || request.ackSequence == null || request.ackSequence < 0) {
            throw error(ApiError.WEBRTC_REQUEST_INVALID);
        }
        List<WebRtcOutgoingEvent> outgoingEvents = request.events == null ? Collections.emptyList() : request.events;
        if (outgoingEvents.size() > config.maxOutgoingEventsPerSync) {
            throw error(ApiError.WEBRTC_EVENT_LIMIT_EXCEEDED);
        }

        WebRtcSessionState session = requireSession(sessionId);
        String participantId = verifyParticipantToken(session.sessionId, authorization);
        List<PreparedOutgoingEvent> preparedEvents = prepareOutgoingEvents(outgoingEvents, participantId);
        WebRtcSyncResponse response = new WebRtcSyncResponse();
        List<WebRtcStoredEvent> pendingEventsSnapshot;
        synchronized (session) {
            long now = System.currentTimeMillis();
            WebRtcParticipantState self = requireParticipantLocked(session, participantId);
            if (!session.closed && shouldExpireLocked(session, now)) {
                closeSessionLocked(session, "SESSION_EXPIRED", null, now);
            }

            // 确认游标、接收出站事件和读取待投递事件必须在同一把锁内完成，避免漏投或重复删除。
            acknowledgeLocked(self, request.ackSequence);
            for (PreparedOutgoingEvent preparedEvent : preparedEvents) {
                acceptOutgoingEventLocked(session, self, preparedEvent, response, now);
            }

            self.lastActivityAt = now;
            if (!session.closed) {
                session.lastActivityAt = Math.max(session.lastActivityAt, now);
            }
            // 事件对象入队后保持只读，锁内只复制引用列表，payload 深拷贝在解锁后完成。
            pendingEventsSnapshot = new ArrayList<>(self.pendingEvents);
            response.lastSequence = self.nextSequence - 1;
            response.serverTime = now;
            response.sessionState = session.state;
            response.sessionCloseReason = session.closedReason;
            response.participants = participantInfosLocked(session, self.participantId);
        }
        for (WebRtcStoredEvent event : pendingEventsSnapshot) {
            response.events.add(signalEvent(event));
        }
        completeParticipantInfos(response.participants);
        return response;
    }

    /** 让当前参与者离开会话，并按其角色决定是否关闭整个会话。 */
    public WebRtcLeaveResponse leave(String sessionId, String authorization, String reason) {
        WebRtcSessionState session = requireSession(sessionId);
        String participantId = verifyParticipantToken(session.sessionId, authorization);
        boolean purge = false;
        WebRtcLeaveResponse response = new WebRtcLeaveResponse();

        synchronized (session) {
            long now = System.currentTimeMillis();
            WebRtcParticipantState self = requireParticipantLocked(session, participantId);
            response.participantId = self.participantId;
            response.leftAt = now;

            if (session.closed) {
                removeParticipantLocked(session, self, null, now, false);
                response.sessionClosed = true;
                if (session.participants.isEmpty()) {
                    session.purged = true;
                    purge = true;
                }
            } else if (OWNER.equals(self.role)) {
                closeSessionLocked(session, normalizedReason(reason, "OWNER_LEFT"), self.participantId, now);
                removeParticipantLocked(session, self, null, now, false);
                response.sessionClosed = true;
            } else {
                removeParticipantLocked(session, self, normalizedReason(reason, "CLIENT_LEAVE"), now, true);
                response.sessionClosed = false;
            }
        }

        // 会话索引移除不依赖会话内部状态，放在锁外缩短临界区。
        if (purge) {
            removeSessionIndexes(session);
        }
        return response;
    }

    /** 校验创建者身份并主动关闭指定会话。 */
    public WebRtcCloseSessionResponse close(String sessionId, String authorization, String reason) {
        WebRtcSessionState session = requireSession(sessionId);
        String participantId = verifyParticipantToken(session.sessionId, authorization);
        synchronized (session) {
            long now = System.currentTimeMillis();
            WebRtcParticipantState self = requireParticipantLocked(session, participantId);
            if (!OWNER.equals(self.role)) {
                throw error(ApiError.WEBRTC_OWNER_REQUIRED);
            }
            if (!session.closed) {
                closeSessionLocked(session, normalizedReason(reason, "CLIENT_CLOSED"), self.participantId, now);
            }
            WebRtcCloseSessionResponse response = new WebRtcCloseSessionResponse();
            response.sessionId = session.sessionId;
            response.closedAt = session.closedAt;
            return response;
        }
    }

    /** 创建包含 OWNER 参与者的初始内存会话状态。 */
    private WebRtcSessionState newSession(String keyHash,
                                          WebRtcCreateSessionRequest request,
                                          byte[] ownerClientKeyHash,
                                          long now) {
        WebRtcSessionState session = new WebRtcSessionState();
        session.sessionId = randomId("ses_");
        session.sessionKeyHash = keyHash;
        session.application = request.application;
        session.applicationVersion = request.applicationVersion;
        session.maxParticipants = request.maxParticipants == null ? config.maxParticipants : request.maxParticipants;
        session.metadata = copyJson(request.metadata);
        session.createdAt = now;
        session.lastActivityAt = Math.max(session.lastActivityAt, now);
        session.state = WAITING;

        WebRtcParticipantState owner = newParticipant(request.participant, OWNER, ownerClientKeyHash);
        owner.joinedAt = now;
        owner.lastActivityAt = now;
        session.ownerParticipantId = owner.participantId;
        session.participants.put(owner.participantId, owner);
        session.participantsByClientId.put(owner.clientId, owner);
        return session;
    }

    /** 将参与者请求转换为尚未加入会话的参与者状态。 */
    private WebRtcParticipantState newParticipant(WebRtcParticipantRequest request, String role, byte[] requestedClientKeyHash) {
        WebRtcParticipantState participant = new WebRtcParticipantState();
        participant.participantId = randomId("par_");
        participant.clientId = request.clientId;
        participant.clientKeyHash = requestedClientKeyHash;
        participant.displayName = request.displayName.trim();
        participant.role = role;
        participant.capabilities = copyCapabilities(request.capabilities);
        participant.metadata = copyJson(request.metadata);
        return participant;
    }

    /** 在获取会话锁前完成客户端出站事件的纯计算准备工作。 */
    private List<PreparedOutgoingEvent> prepareOutgoingEvents(List<WebRtcOutgoingEvent> outgoingEvents,
                                                              String sourceParticipantId) {
        List<PreparedOutgoingEvent> preparedEvents = new ArrayList<>(outgoingEvents.size());
        for (WebRtcOutgoingEvent outgoingEvent : outgoingEvents) {
            preparedEvents.add(prepareOutgoingEvent(outgoingEvent, sourceParticipantId));
        }
        return preparedEvents;
    }

    /** 校验单条出站事件，并提前计算 payload 大小及创建服务端私有副本。 */
    private PreparedOutgoingEvent prepareOutgoingEvent(WebRtcOutgoingEvent outgoing, String sourceParticipantId) {
        String eventId = outgoing == null ? null : outgoing.eventId;
        if (outgoing == null || !validText(eventId, MAX_TEXT_FIELD_LENGTH)) {
            return new PreparedOutgoingEvent(
                    eventId,
                    false,
                    null,
                    null,
                    null,
                    null,
                    0,
                    "WEBRTC_EVENT_ID_INVALID",
                    "eventId is required and must not exceed 128 characters"
            );
        }
        if (!validText(outgoing.type, MAX_TEXT_FIELD_LENGTH) || !EVENT_TYPE_PATTERN.matcher(outgoing.type).matches()) {
            return new PreparedOutgoingEvent(
                    eventId,
                    true,
                    null,
                    null,
                    null,
                    null,
                    0,
                    "WEBRTC_EVENT_TYPE_INVALID",
                    "Event type is invalid"
            );
        }
        if (outgoing.type.startsWith("participant.") || outgoing.type.startsWith("session.")) {
            return new PreparedOutgoingEvent(
                    eventId,
                    true,
                    null,
                    null,
                    null,
                    null,
                    0,
                    "WEBRTC_EVENT_TYPE_RESERVED",
                    "Event type is reserved for the server"
            );
        }
        if (!validText(outgoing.targetParticipantId, MAX_TEXT_FIELD_LENGTH)
                || sourceParticipantId.equals(outgoing.targetParticipantId)) {
            return new PreparedOutgoingEvent(
                    eventId,
                    true,
                    null,
                    null,
                    null,
                    null,
                    0,
                    "WEBRTC_TARGET_PARTICIPANT_INVALID",
                    "Target participant is invalid"
            );
        }
        if (outgoing.negotiationId != null && outgoing.negotiationId.length() > MAX_TEXT_FIELD_LENGTH) {
            return new PreparedOutgoingEvent(
                    eventId,
                    true,
                    null,
                    null,
                    null,
                    null,
                    0,
                    "WEBRTC_NEGOTIATION_ID_INVALID",
                    "negotiationId is too long"
            );
        }
        int payloadBytes = jsonSize(outgoing.payload);
        if (payloadBytes > config.maxEventPayloadBytes) {
            return new PreparedOutgoingEvent(
                    eventId,
                    true,
                    null,
                    null,
                    null,
                    null,
                    payloadBytes,
                    "WEBRTC_EVENT_PAYLOAD_TOO_LARGE",
                    "Event payload is too large"
            );
        }
        return new PreparedOutgoingEvent(
                eventId,
                true,
                outgoing.type,
                outgoing.targetParticipantId,
                outgoing.negotiationId,
                copyJson(outgoing.payload),
                payloadBytes,
                null,
                null
        );
    }

    /**
     * 提交准备完成的客户端出站事件，将其加入目标参与者队列。
     * 调用方必须持有会话锁，因为事件去重、目标检查、配额预留和队列写入需要作为一个原子操作完成。
     */
    private void acceptOutgoingEventLocked(WebRtcSessionState session,
                                           WebRtcParticipantState source,
                                           PreparedOutgoingEvent outgoing,
                                           WebRtcSyncResponse response,
                                           long now) {
        if (!outgoing.eventIdValid()) {
            reject(response, outgoing.eventId(), outgoing.rejectionCode(), outgoing.rejectionMessage());
            return;
        }
        if (source.acceptedEventIds.contains(outgoing.eventId())) {
            // 前端可能因网络超时重发同一批事件，eventId 用于实现幂等接收。
            response.acceptedEventIds.add(outgoing.eventId());
            return;
        }
        if (session.closed) {
            reject(response, outgoing.eventId(), ApiError.WEBRTC_SESSION_CLOSED.name(), "Session is closed");
            return;
        }
        if (outgoing.rejectionCode() != null) {
            reject(response, outgoing.eventId(), outgoing.rejectionCode(), outgoing.rejectionMessage());
            return;
        }

        WebRtcParticipantState target = session.participants.get(outgoing.targetParticipantId());
        if (target == null) {
            reject(response, outgoing.eventId(), "WEBRTC_TARGET_PARTICIPANT_NOT_FOUND", "Target participant does not exist");
            return;
        }
        // 同时限制事件条数和序列化字节数，防止离线参与者的队列无限占用内存。
        if (target.pendingEvents.size() >= config.maxPendingEventsPerParticipant
                || target.pendingEventBytes + outgoing.payloadBytes() > config.maxPendingEventBytesPerParticipant) {
            reject(response, outgoing.eventId(), "WEBRTC_EVENT_QUEUE_FULL", "Target event queue is full");
            return;
        }

        WebRtcStoredEvent event = new WebRtcStoredEvent();
        event.sequence = target.nextSequence++;
        event.eventId = outgoing.eventId();
        event.type = outgoing.type();
        event.sourceParticipantId = source.participantId;
        event.targetParticipantId = target.participantId;
        event.negotiationId = outgoing.negotiationId();
        event.payload = outgoing.payload();
        event.payloadBytes = outgoing.payloadBytes();
        event.createdAt = now;
        target.pendingEvents.addLast(event);
        target.pendingEventBytes += event.payloadBytes;
        rememberAcceptedEvent(source, outgoing.eventId());
        response.acceptedEventIds.add(outgoing.eventId());
    }

    /**
     * 根据确认序号移除参与者已经消费的待投递事件。
     * 调用方必须持有所属会话锁，避免确认操作与事件入队同时修改待投递队列和累计字节数。
     */
    private void acknowledgeLocked(WebRtcParticipantState participant, long ackSequence) {
        long highestAssigned = participant.nextSequence - 1;
        if (ackSequence > highestAssigned) {
            throw error(ApiError.WEBRTC_ACK_SEQUENCE_INVALID);
        }
        if (ackSequence <= participant.lastAcknowledgedSequence) {
            return;
        }
        // 仅删除客户端明确确认的连续前缀，未确认事件会在后续 sync 中继续返回。
        while (!participant.pendingEvents.isEmpty()
                && participant.pendingEvents.peekFirst().sequence <= ackSequence) {
            WebRtcStoredEvent removed = participant.pendingEvents.removeFirst();
            participant.pendingEventBytes -= removed.payloadBytes;
        }
        participant.lastAcknowledgedSequence = ackSequence;
    }

    /**
     * 向会话内其他参与者广播新参与者加入事件。
     * 调用方必须持有会话锁，避免广播期间参与者集合变化而造成遍历异常或接收方遗漏。
     */
    private void emitParticipantJoinedLocked(WebRtcSessionState session, WebRtcParticipantState joined, long now) {
        ObjectNode payload = JsonUtils.createObjectNode();
        payload.put("participantId", joined.participantId);
        payload.put("displayName", joined.displayName);
        payload.put("role", joined.role);
        payload.put("joinedAt", joined.joinedAt);
        ArrayNode capabilities = JsonUtils.createArrayNode();
        for (String capability : joined.capabilities) {
            capabilities.add(capability);
        }
        payload.set("capabilities", capabilities);
        if (joined.metadata != null) {
            payload.set("metadata", joined.metadata);
        }
        int payloadBytes = jsonSize(payload);
        for (WebRtcParticipantState participant : session.participants.values()) {
            if (!participant.participantId.equals(joined.participantId)) {
                enqueueServerEventLocked(
                        participant,
                        "participant.joined",
                        joined.participantId,
                        payload,
                        payloadBytes,
                        now
                );
            }
        }
    }

    /**
     * 向会话内剩余参与者广播参与者离开事件。
     * 调用方必须持有会话锁，确保离开操作与接收方事件入队基于同一份参与者快照。
     */
    private void emitParticipantLeftLocked(WebRtcSessionState session, WebRtcParticipantState left, String reason, long now) {
        ObjectNode payload = JsonUtils.createObjectNode();
        payload.put("participantId", left.participantId);
        payload.put("reason", reason);
        payload.put("leftAt", now);
        int payloadBytes = jsonSize(payload);
        for (WebRtcParticipantState participant : session.participants.values()) {
            enqueueServerEventLocked(participant, "participant.left", left.participantId, payload, payloadBytes, now);
        }
    }

    /**
     * 将会话标记为关闭并向仍在线的参与者投递关闭事件。
     * 调用方必须持有会话锁，确保关闭状态只转换一次，并与关闭事件投递保持一致。
     */
    private void closeSessionLocked(WebRtcSessionState session, String reason, String closedBy, long now) {
        if (session.closed || session.purged) {
            return;
        }
        session.closed = true;
        session.state = CLOSED;
        session.closedAt = now;
        session.closedReason = reason;
        session.closedBy = closedBy;
        session.lastActivityAt = Math.max(session.lastActivityAt, now);
        // 关闭后立即释放连接码，但按 sessionId 暂存会话，以便参与者拉取 session.closed 事件。
        sessionsByKeyHash.remove(session.sessionKeyHash, session);

        ObjectNode payload = JsonUtils.createObjectNode();
        payload.put("sessionId", session.sessionId);
        payload.put("reason", reason);
        if (closedBy == null) {
            payload.putNull("closedBy");
        } else {
            payload.put("closedBy", closedBy);
        }
        payload.put("closedAt", now);
        int payloadBytes = jsonSize(payload);
        for (WebRtcParticipantState participant : session.participants.values()) {
            if (closedBy == null || !participant.participantId.equals(closedBy)) {
                enqueueServerEventLocked(participant, "session.closed", closedBy, payload, payloadBytes, now);
            }
        }
    }

    /**
     * 创建服务端事件并将其加入指定参与者的待投递队列。
     * 调用方必须持有所属会话锁，以串行更新事件序号、队列内容和累计字节数。
     */
    private void enqueueServerEventLocked(WebRtcParticipantState target,
                                           String type,
                                           String sourceParticipantId,
                                           JsonNode payload,
                                           int payloadBytes,
                                           long now) {
        if (target.pendingEvents.size() >= config.maxPendingEventsPerParticipant
                || target.pendingEventBytes + payloadBytes > config.maxPendingEventBytesPerParticipant) {
            return;
        }
        WebRtcStoredEvent event = new WebRtcStoredEvent();
        event.sequence = target.nextSequence++;
        event.eventId = randomId("evt_");
        event.type = type;
        event.sourceParticipantId = sourceParticipantId;
        event.targetParticipantId = target.participantId;
        event.payload = payload;
        event.payloadBytes = payloadBytes;
        event.createdAt = now;
        target.pendingEvents.addLast(event);
        target.pendingEventBytes += event.payloadBytes;
    }

    /**
     * 从会话索引中移除参与者，并按需通知其他参与者。
     * 调用方必须持有会话锁，使两个参与者索引、会话状态和离开事件同步完成变更。
     */
    private void removeParticipantLocked(WebRtcSessionState session,
                                         WebRtcParticipantState participant,
                                         String reason,
                                         long now,
                                         boolean notify) {
        session.participants.remove(participant.participantId);
        session.participantsByClientId.remove(participant.clientId, participant);
        participant.pendingEvents.clear();
        participant.pendingEventBytes = 0;
        session.lastActivityAt = Math.max(session.lastActivityAt, now);
        if (!session.closed) {
            updateStateLocked(session);
        }
        if (notify) {
            emitParticipantLeftLocked(session, participant, reason, now);
        }
    }

    /** 在会话锁外验证 Bearer Token 格式和签名，并返回其中的参与者 ID。 */
    private String verifyParticipantToken(String sessionId, String authorization) {
        String token = bearerToken(authorization);
        int separator = token.indexOf('.');
        if (separator <= 0 || separator == token.length() - 1) {
            throw error(ApiError.WEBRTC_PARTICIPANT_TOKEN_INVALID);
        }
        String participantId = token.substring(0, separator);
        String signature = token.substring(separator + 1);
        byte[] suppliedSignature;
        try {
            suppliedSignature = Base64.getUrlDecoder().decode(signature);
        } catch (IllegalArgumentException e) {
            throw error(ApiError.WEBRTC_PARTICIPANT_TOKEN_INVALID);
        }
        byte[] expectedSignature = hmac(participantTokenSecret, sessionId + "\n" + participantId);
        // 使用常量时间比较，避免签名比较过程泄露有效前缀信息。
        if (!MessageDigest.isEqual(expectedSignature, suppliedSignature)) {
            throw error(ApiError.WEBRTC_PARTICIPANT_TOKEN_INVALID);
        }
        return participantId;
    }

    /**
     * 确认验签通过的参与者当前仍属于指定会话。
     * 调用方必须持有会话锁，避免成员检查通过后参与者在后续业务操作前被移除。
     */
    private WebRtcParticipantState requireParticipantLocked(WebRtcSessionState session, String participantId) {
        requireAvailableSessionLocked(session);
        WebRtcParticipantState participant = session.participants.get(participantId);
        if (participant == null) {
            throw error(ApiError.WEBRTC_PARTICIPANT_NOT_IN_SESSION);
        }
        return participant;
    }

    /** 根据后端会话 ID 查找会话，不存在时返回统一业务异常。 */
    private WebRtcSessionState requireSession(String sessionId) {
        if (!validText(sessionId, MAX_TEXT_FIELD_LENGTH)) {
            throw error(ApiError.WEBRTC_SESSION_NOT_FOUND);
        }
        WebRtcSessionState session = sessionsById.get(sessionId);
        if (session == null) {
            throw error(ApiError.WEBRTC_SESSION_NOT_FOUND);
        }
        return session;
    }

    /**
     * 确认会话仍存在于主索引且尚未被彻底清理。
     * 调用方必须持有会话锁，保证读取的 purged 状态与后续会话操作之间不会发生生命周期切换。
     */
    private void requireAvailableSessionLocked(WebRtcSessionState session) {
        if (session.purged || sessionsById.get(session.sessionId) != session) {
            throw error(ApiError.WEBRTC_SESSION_NOT_FOUND);
        }
    }

    /**
     * 构造创建或加入成功后返回给当前参与者的连接信息。
     * 调用方必须持有会话锁，确保会话字段和参与者列表来自同一个一致快照。
     */
    private WebRtcSessionConnectionResponse connectionResponseLocked(WebRtcSessionState session, WebRtcParticipantState self) {
        WebRtcSessionConnectionResponse response = new WebRtcSessionConnectionResponse();
        response.sessionId = session.sessionId;
        response.participantId = self.participantId;
        response.role = self.role;
        response.application = session.application;
        response.applicationVersion = session.applicationVersion;
        response.maxParticipants = session.maxParticipants;
        response.createdAt = session.createdAt;
        response.lastActivityAt = session.lastActivityAt;
        response.metadata = session.metadata;
        response.participants = participantInfosLocked(session, self.participantId);
        return response;
    }

    /** 在会话锁外生成访问令牌，并将连接快照中的内部只读数据复制到公开 DTO。 */
    private WebRtcSessionConnectionResponse completeConnectionResponse(WebRtcSessionConnectionResponse response) {
        response.participantToken = participantToken(response.sessionId, response.participantId);
        response.metadata = copyJson(response.metadata);
        completeParticipantInfos(response.participants);
        return response;
    }

    /**
     * 构造当前参与者可见的完整会话快照。
     * 调用方必须持有会话锁，避免组装响应时会话状态或参与者集合被并发修改。
     */
    private WebRtcSessionInfo sessionInfoLocked(WebRtcSessionState session, WebRtcParticipantState self) {
        WebRtcSessionInfo response = new WebRtcSessionInfo();
        response.sessionId = session.sessionId;
        response.application = session.application;
        response.applicationVersion = session.applicationVersion;
        response.state = session.state;
        response.maxParticipants = session.maxParticipants;
        response.createdAt = session.createdAt;
        response.lastActivityAt = session.lastActivityAt;
        response.metadata = session.metadata;
        response.self = participantInfoLocked(self);
        response.participants = participantInfosLocked(session, self.participantId);
        return response;
    }

    /** 在会话锁外将会话快照中的 metadata 和参与者信息转换为独立公开副本。 */
    private WebRtcSessionInfo completeSessionInfo(WebRtcSessionInfo response) {
        response.metadata = copyJson(response.metadata);
        completeParticipantInfo(response.self);
        completeParticipantInfos(response.participants);
        return response;
    }

    /**
     * 构造会话参与者列表，并排除指定参与者。
     * 调用方必须持有会话锁，因为底层 LinkedHashMap 不支持与参与者加入或离开操作并发遍历。
     */
    private List<WebRtcParticipantInfo> participantInfosLocked(WebRtcSessionState session, String excludedParticipantId) {
        List<WebRtcParticipantInfo> participants = new ArrayList<>();
        for (WebRtcParticipantState participant : session.participants.values()) {
            if (!participant.participantId.equals(excludedParticipantId)) {
                participants.add(participantInfoLocked(participant));
            }
        }
        return participants;
    }

    /**
     * 捕获参与者的标量字段及内部只读数据引用。
     * 调用方必须持有会话锁，以保证 lastActivityAt 与参与者成员快照处于同一时刻。
     */
    private WebRtcParticipantInfo participantInfoLocked(WebRtcParticipantState participant) {
        WebRtcParticipantInfo info = new WebRtcParticipantInfo();
        info.participantId = participant.participantId;
        info.displayName = participant.displayName;
        info.role = participant.role;
        info.capabilities = participant.capabilities;
        info.metadata = participant.metadata;
        info.joinedAt = participant.joinedAt;
        info.lastActivityAt = participant.lastActivityAt;
        return info;
    }

    /** 在会话锁外将参与者快照中的集合和 JSON 数据替换为独立副本。 */
    private void completeParticipantInfo(WebRtcParticipantInfo info) {
        if (info == null) {
            return;
        }
        info.capabilities = new ArrayList<>(info.capabilities);
        info.metadata = copyJson(info.metadata);
    }

    /** 在会话锁外完成参与者快照列表中的可变数据复制。 */
    private void completeParticipantInfos(List<WebRtcParticipantInfo> participants) {
        for (WebRtcParticipantInfo participant : participants) {
            completeParticipantInfo(participant);
        }
    }

    /** 将队列中的内部事件转换为同步接口的信令事件。 */
    private WebRtcSignalEvent signalEvent(WebRtcStoredEvent stored) {
        WebRtcSignalEvent event = new WebRtcSignalEvent();
        event.sequence = stored.sequence;
        event.eventId = stored.eventId;
        event.type = stored.type;
        event.sourceParticipantId = stored.sourceParticipantId;
        event.targetParticipantId = stored.targetParticipantId;
        event.negotiationId = stored.negotiationId;
        event.createdAt = stored.createdAt;
        event.payload = copyJson(stored.payload);
        return event;
    }

    /** 校验创建会话请求及其嵌套字段和大小限制。 */
    private void validateCreateRequest(WebRtcCreateSessionRequest request) {
        if (request == null) {
            throw error(ApiError.WEBRTC_REQUEST_INVALID);
        }
        validateSessionKey(request.sessionKey);
        validateApplication(request.application, request.applicationVersion);
        validateParticipantRequest(request.participant);
        int requestedMax = request.maxParticipants == null ? config.maxParticipants : request.maxParticipants;
        if (requestedMax < 2 || requestedMax > config.maxParticipants) {
            throw error(ApiError.WEBRTC_REQUEST_INVALID);
        }
        validateMetadataSize(request.metadata);
    }

    /** 校验加入会话请求及其嵌套字段。 */
    private void validateJoinRequest(WebRtcJoinSessionRequest request) {
        if (request == null) {
            throw error(ApiError.WEBRTC_REQUEST_INVALID);
        }
        validateSessionKey(request.sessionKey);
        validateApplication(request.application, request.applicationVersion);
        validateParticipantRequest(request.participant);
    }

    /** 校验前端连接码的长度和允许字符。 */
    private void validateSessionKey(String sessionKey) {
        if (sessionKey == null
                || sessionKey.length() < SESSION_KEY_MIN_LENGTH
                || sessionKey.length() > SESSION_KEY_MAX_LENGTH
                || !SESSION_KEY_PATTERN.matcher(sessionKey).matches()) {
            throw error(ApiError.WEBRTC_SESSION_KEY_INVALID);
        }
    }

    /** 校验上层应用名称及其协议版本。 */
    private void validateApplication(String application, Integer applicationVersion) {
        if (!validText(application, MAX_APPLICATION_LENGTH)
                || !APPLICATION_PATTERN.matcher(application).matches()
                || applicationVersion == null
                || applicationVersion < 1) {
            throw error(ApiError.WEBRTC_REQUEST_INVALID);
        }
    }

    /** 校验参与者身份字段、能力列表和附加信息。 */
    private void validateParticipantRequest(WebRtcParticipantRequest participant) {
        if (participant == null
                || !validText(participant.clientId, MAX_TEXT_FIELD_LENGTH)
                || participant.clientKey == null
                || participant.clientKey.length() < PARTICIPANT_KEY_MIN_LENGTH
                || participant.clientKey.length() > PARTICIPANT_KEY_MAX_LENGTH
                || !SESSION_KEY_PATTERN.matcher(participant.clientKey).matches()
                || !validText(participant.displayName, MAX_TEXT_FIELD_LENGTH)) {
            throw error(ApiError.WEBRTC_REQUEST_INVALID);
        }
        if (participant.capabilities != null) {
            if (participant.capabilities.size() > MAX_CAPABILITIES) {
                throw error(ApiError.WEBRTC_REQUEST_INVALID);
            }
            for (String capability : participant.capabilities) {
                if (!validText(capability, MAX_CAPABILITY_LENGTH)) {
                    throw error(ApiError.WEBRTC_REQUEST_INVALID);
                }
            }
        }
        validateMetadataSize(participant.metadata);
    }

    /** 校验 JSON 附加信息序列化后的字节大小。 */
    private void validateMetadataSize(JsonNode value) {
        if (jsonSize(value) > config.maxMetadataBytes) {
            throw error(ApiError.WEBRTC_REQUEST_INVALID);
        }
    }

    /** 计算 JSON 节点序列化为 UTF-8 数据后的字节数。 */
    private int jsonSize(JsonNode value) {
        return value == null ? 0 : JsonUtils.writeValueAsBytes(value).length;
    }

    /** 复制能力列表并在保持原顺序的同时去重。 */
    private List<String> copyCapabilities(List<String> capabilities) {
        if (capabilities == null || capabilities.isEmpty()) {
            return new ArrayList<>();
        }
        Set<String> unique = new LinkedHashSet<>(capabilities);
        return new ArrayList<>(unique);
    }

    /** 深拷贝 JSON 节点，避免请求对象和内存状态共享可变数据。 */
    private JsonNode copyJson(JsonNode value) {
        return value == null || value.isNull() ? null : value.deepCopy();
    }

    /**
     * 根据参与者数量更新会话的等待或活跃状态。
     * 调用方必须持有会话锁，确保参与者数量和由其推导出的会话状态保持一致。
     */
    private void updateStateLocked(WebRtcSessionState session) {
        session.state = session.participants.size() >= 2 ? ACTIVE : WAITING;
    }

    /**
     * 刷新参与者及其所属会话的最后活动时间。
     * 调用方必须持有会话锁，避免请求线程与清理线程交叉更新活动时间而发生误判超时。
     */
    private void touchLocked(WebRtcSessionState session, WebRtcParticipantState participant, long now) {
        participant.lastActivityAt = now;
        session.lastActivityAt = Math.max(session.lastActivityAt, now);
    }

    /**
     * 判断会话是否达到空闲超时。
     * 调用方必须持有会话锁，确保过期判断使用的最后活动时间是稳定快照。
     */
    private boolean shouldExpireLocked(WebRtcSessionState session, long now) {
        return now - session.lastActivityAt >= config.sessionIdleTimeoutMs;
    }

    /** 为参与者生成绑定会话 ID 和参与者 ID 的签名访问令牌。 */
    private String participantToken(String sessionId, String participantId) {
        byte[] signature = hmac(participantTokenSecret, sessionId + "\n" + participantId);
        return participantId + "." + Base64.getUrlEncoder().withoutPadding().encodeToString(signature);
    }

    /** 从 Authorization 请求头中提取 Bearer Token。 */
    private String bearerToken(String authorization) {
        if (authorization == null || !authorization.regionMatches(true, 0, "Bearer ", 0, 7)) {
            throw error(ApiError.WEBRTC_PARTICIPANT_TOKEN_INVALID);
        }
        String token = authorization.substring(7).trim();
        if (token.isEmpty()) {
            throw error(ApiError.WEBRTC_PARTICIPANT_TOKEN_INVALID);
        }
        return token;
    }

    /** 将原始连接码转换为不可逆的进程内索引值。 */
    private String sessionKeyHash(String sessionKey) {
        // 内存索引不保存用户输入的原始连接码，降低进程内存泄露后的暴露范围。
        return Base64.getUrlEncoder().withoutPadding().encodeToString(hmac(sessionKeySecret, sessionKey));
    }

    /** 计算 clientKey 的 HMAC，用于校验连接请求的幂等身份。 */
    private byte[] clientKeyHash(String clientKey) {
        return hmac(participantTokenSecret, "client-key\n" + clientKey);
    }

    /** 使用常量时间比较判断预先计算的 clientKey 摘要是否属于指定参与者。 */
    private boolean matchesClientKey(WebRtcParticipantState participant, byte[] requestedClientKeyHash) {
        return requestedClientKeyHash != null
                && MessageDigest.isEqual(participant.clientKeyHash, requestedClientKeyHash);
    }

    /** 使用指定密钥计算字符串的 HmacSHA256 摘要。 */
    private byte[] hmac(byte[] secret, String value) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            return mac.doFinal(value.getBytes(StandardCharsets.UTF_8));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("HmacSHA256 is unavailable", e);
        }
    }

    /** 生成进程生命周期内使用的高熵随机密钥。 */
    private static byte[] randomSecret() {
        byte[] secret = new byte[SECRET_BYTES];
        new SecureRandom().nextBytes(secret);
        return secret;
    }

    /** 生成带业务前缀且不含连字符的随机标识。 */
    private String randomId(String prefix) {
        return prefix + UUID.randomUUID().toString().replace("-", "");
    }

    /** 规范化关闭原因，并在缺失或过长时使用安全值。 */
    private String normalizedReason(String reason, String fallback) {
        if (reason == null || reason.isBlank()) {
            return fallback;
        }
        String normalized = reason.trim();
        return normalized.length() <= MAX_TEXT_FIELD_LENGTH
                ? normalized
                : normalized.substring(0, MAX_TEXT_FIELD_LENGTH);
    }

    /** 判断文本是否非空且未超过指定长度。 */
    private boolean validText(String value, int maxLength) {
        return value != null && !value.isBlank() && value.length() <= maxLength;
    }

    /** 根据错误枚举创建统一业务异常。 */
    private ApiException error(ApiError error) {
        return new ApiException(error);
    }

    /** 以原子方式预占一个会话名额。 */
    private boolean reserveSessionSlot() {
        // CAS 保证并发创建时不会突破进程级最大会话数。
        while (true) {
            int current = sessionCount.get();
            if (current >= config.maxSessions) {
                return false;
            }
            if (sessionCount.compareAndSet(current, current + 1)) {
                return true;
            }
        }
    }

    /** 释放一个已预占或已清理的会话名额。 */
    private void releaseSessionSlot() {
        sessionCount.updateAndGet(current -> Math.max(0, current - 1));
    }

    /** 记录已接收事件 ID，并将幂等记录限制在固定容量内。 */
    private void rememberAcceptedEvent(WebRtcParticipantState participant, String eventId) {
        participant.acceptedEventIds.add(eventId);
        // 幂等记录采用有界集合，避免长时间会话持续积累已经完成的 eventId。
        int maxRemembered = Math.max(1_024, config.maxPendingEventsPerParticipant * 8);
        while (participant.acceptedEventIds.size() > maxRemembered) {
            Iterator<String> iterator = participant.acceptedEventIds.iterator();
            iterator.next();
            iterator.remove();
        }
    }

    /** 将单条客户端事件的拒绝原因写入同步响应。 */
    private void reject(WebRtcSyncResponse response, String eventId, String code, String message) {
        WebRtcRejectedEvent rejected = new WebRtcRejectedEvent();
        rejected.eventId = eventId;
        rejected.code = code;
        rejected.message = message;
        response.rejectedEvents.add(rejected);
    }

    /** 执行清理任务并捕获异常，避免定时调度因异常永久停止。 */
    private void cleanupSafely() {
        try {
            cleanupSessions(System.currentTimeMillis());
        } catch (Throwable throwable) {
            LOG.error("Failed to clean WebRTC signaling sessions", throwable);
        }
    }

    /** 按指定时间清理超时参与者、过期会话和已关闭会话。 */
    void cleanupSessions(long now) {
        for (WebRtcSessionState session : sessionsById.values()) {
            boolean purge = false;
            // 清理线程与请求线程遵循相同锁约定，保证超时和主动操作不会交叉修改会话。
            synchronized (session) {
                if (session.purged) {
                    purge = true;
                } else if (session.closed) {
                    if (now - session.closedAt >= config.closedSessionRetentionMs) {
                        session.purged = true;
                        purge = true;
                    }
                } else if (now - session.lastActivityAt >= config.sessionIdleTimeoutMs) {
                    closeSessionLocked(session, "SESSION_EXPIRED", null, now);
                } else {
                    List<WebRtcParticipantState> timedOut = new ArrayList<>();
                    WebRtcParticipantState timedOutOwner = null;
                    for (WebRtcParticipantState participant : session.participants.values()) {
                        long idleTime = now - participant.lastActivityAt;
                        if (OWNER.equals(participant.role)) {
                            // 房主使用更长的会话空闲窗口，允许移动设备短暂息屏后恢复原身份。
                            if (idleTime >= config.sessionIdleTimeoutMs) timedOutOwner = participant;
                        } else if (idleTime >= config.participantIdleTimeoutMs) {
                            timedOut.add(participant);
                        }
                    }

                    if (timedOutOwner != null) {
                        closeSessionLocked(session, "PARTICIPANT_TIMEOUT", timedOutOwner.participantId, now);
                        removeParticipantLocked(session, timedOutOwner, null, now, false);
                        for (WebRtcParticipantState participant : timedOut) {
                            removeParticipantLocked(session, participant, null, now, false);
                        }
                    } else {
                        for (WebRtcParticipantState participant : timedOut) {
                            removeParticipantLocked(session, participant, "TIMEOUT", now, true);
                        }
                    }

                    if (!session.closed
                            && session.participants.isEmpty()
                            && now - session.lastActivityAt >= config.emptySessionTimeoutMs) {
                        session.purged = true;
                        purge = true;
                    }
                }
            }
            // 只在状态已标记为 purged 后删除索引，避免其他线程观察到半清理状态。
            if (purge) {
                removeSessionIndexes(session);
            }
        }
    }

    /** 从两个会话索引中移除状态并释放会话名额。 */
    private void removeSessionIndexes(WebRtcSessionState session) {
        sessionsByKeyHash.remove(session.sessionKeyHash, session);
        if (sessionsById.remove(session.sessionId, session)) {
            releaseSessionSlot();
        }
    }

    /** 规范化所有配置项，并为缺失的 ICE 配置补充默认 STUN。 */
    private void normalizeConfig() {
        config.participantIdleTimeoutMs = positive(config.participantIdleTimeoutMs, 30_000L);
        config.emptySessionTimeoutMs = positive(config.emptySessionTimeoutMs, 30_000L);
        config.sessionIdleTimeoutMs = positive(config.sessionIdleTimeoutMs, 120_000L);
        config.cleanupIntervalMs = positive(config.cleanupIntervalMs, 10_000L);
        config.closedSessionRetentionMs = positive(config.closedSessionRetentionMs, 30_000L);
        config.maxSessions = positive(config.maxSessions, 100);
        config.maxParticipants = Math.max(2, positive(config.maxParticipants, 10));
        config.maxPendingEventsPerParticipant = positive(config.maxPendingEventsPerParticipant, 128);
        config.maxPendingEventBytesPerParticipant = positive(config.maxPendingEventBytesPerParticipant, 1_048_576);
        config.maxOutgoingEventsPerSync = positive(config.maxOutgoingEventsPerSync, 32);
        config.maxEventPayloadBytes = positive(config.maxEventPayloadBytes, 262_144);
        config.maxMetadataBytes = positive(config.maxMetadataBytes, 16_384);
        if (config.iceServers == null || config.iceServers.isEmpty()) {
            config.iceServers = WebRtcConfig.defaultIceServers();
        }
    }

    /** 返回正整数配置值，无效时使用默认值。 */
    private Integer positive(Integer value, int fallback) {
        return value == null || value <= 0 ? fallback : value;
    }

    /** 返回正长整数配置值，无效时使用默认值。 */
    private Long positive(Long value, long fallback) {
        return value == null || value <= 0 ? fallback : value;
    }

    /** 深拷贝有效的 ICE 服务器配置，空列表时返回默认配置。 */
    private List<WebRtcIceServerConfig> copyIceServers(List<WebRtcIceServerConfig> configured) {
        List<WebRtcIceServerConfig> result = new ArrayList<>();
        for (WebRtcIceServerConfig source : configured) {
            if (source == null || source.urls == null || source.urls.isEmpty()) {
                continue;
            }
            WebRtcIceServerConfig target = new WebRtcIceServerConfig();
            target.urls = new ArrayList<>(source.urls);
            target.username = source.username;
            target.credential = source.credential;
            result.add(target);
        }
        return result.isEmpty() ? WebRtcConfig.defaultIceServers() : result;
    }

}
