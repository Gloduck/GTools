package cn.gloduck.api.controller;

import cn.gloduck.api.entity.model.webrtc.WebRtcCloseRequest;
import cn.gloduck.api.entity.model.webrtc.WebRtcCloseSessionResponse;
import cn.gloduck.api.entity.model.webrtc.WebRtcConfigResponse;
import cn.gloduck.api.entity.model.webrtc.WebRtcCreateSessionRequest;
import cn.gloduck.api.entity.model.webrtc.WebRtcJoinSessionRequest;
import cn.gloduck.api.entity.model.webrtc.WebRtcLeaveResponse;
import cn.gloduck.api.entity.model.webrtc.WebRtcSessionConnectionResponse;
import cn.gloduck.api.entity.model.webrtc.WebRtcSessionInfo;
import cn.gloduck.api.entity.model.webrtc.WebRtcSyncRequest;
import cn.gloduck.api.entity.model.webrtc.WebRtcSyncResponse;
import cn.gloduck.api.service.webrtc.WebRtcSignalingService;
import cn.gloduck.common.entity.base.Result;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;

@Path("/api/webrtc/v1")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public class WebRtcController {
    private final WebRtcSignalingService signalingService;

    /** 注入 WebRTC 信令服务。 */
    public WebRtcController(WebRtcSignalingService signalingService) {
        this.signalingService = signalingService;
    }

    /** 返回浏览器建立 WebRTC 连接所需的公开配置。 */
    @GET
    @Path("/config")
    public Result<WebRtcConfigResponse> config() {
        return Result.success(signalingService.config());
    }

    /**
     * 创建新的 WebRTC 信令会话。
     *
     * @param request 前端生成 sessionKey 后提交的会话创建参数
     */
    @POST
    @Path("/sessions")
    public Result<WebRtcSessionConnectionResponse> create(WebRtcCreateSessionRequest request) {
        return Result.success(signalingService.create(request));
    }

    /**
     * 使用连接码加入已有 WebRTC 信令会话。
     *
     * @param request 包含 sessionKey 和加入方设备信息的请求参数
     */
    @POST
    @Path("/sessions/join")
    public Result<WebRtcSessionConnectionResponse> join(WebRtcJoinSessionRequest request) {
        return Result.success(signalingService.join(request));
    }

    /**
     * 查询当前参与者可见的会话状态。
     *
     * @param sessionId     后端生成的会话唯一标识
     * @param authorization 当前参与者的 Bearer Token
     */
    @GET
    @Path("/sessions/{sessionId}")
    public Result<WebRtcSessionInfo> getSession(@PathParam("sessionId") String sessionId,
                                                @HeaderParam(HttpHeaders.AUTHORIZATION) String authorization) {
        return Result.success(signalingService.getSession(sessionId, authorization));
    }

    /**
     * 同步确认游标、出站事件和待接收事件。
     *
     * @param sessionId     后端生成的会话唯一标识
     * @param authorization 当前参与者的 Bearer Token
     * @param request       事件确认游标和本次需要发送的出站事件
     */
    @POST
    @Path("/sessions/{sessionId}/sync")
    public Result<WebRtcSyncResponse> sync(@PathParam("sessionId") String sessionId,
                                           @HeaderParam(HttpHeaders.AUTHORIZATION) String authorization,
                                           WebRtcSyncRequest request) {
        return Result.success(signalingService.sync(sessionId, authorization, request));
    }

    /**
     * 让当前参与者主动离开会话。
     *
     * @param sessionId     后端生成的会话唯一标识
     * @param authorization 当前参与者的 Bearer Token
     * @param request       可选的主动离开原因
     */
    @DELETE
    @Path("/sessions/{sessionId}/participants/me")
    public Result<WebRtcLeaveResponse> leave(@PathParam("sessionId") String sessionId,
                                             @HeaderParam(HttpHeaders.AUTHORIZATION) String authorization,
                                             WebRtcCloseRequest request) {
        String reason = request == null ? null : request.reason;
        return Result.success(signalingService.leave(sessionId, authorization, reason));
    }

    /**
     * 由会话创建者主动关闭整个会话。
     *
     * @param sessionId     后端生成的会话唯一标识
     * @param authorization 会话创建者的 Bearer Token
     * @param request       可选的主动关闭原因
     */
    @DELETE
    @Path("/sessions/{sessionId}")
    public Result<WebRtcCloseSessionResponse> close(@PathParam("sessionId") String sessionId,
                                                    @HeaderParam(HttpHeaders.AUTHORIZATION) String authorization,
                                                    WebRtcCloseRequest request) {
        String reason = request == null ? null : request.reason;
        return Result.success(signalingService.close(sessionId, authorization, reason));
    }
}
