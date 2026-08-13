package cn.gloduck.api.controller;

import cn.gloduck.api.entity.db.OnlineClipBoard;
import cn.gloduck.api.exceptions.ApiError;
import cn.gloduck.api.service.clipboard.OnlineClipBoardService;
import cn.gloduck.common.entity.base.Result;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;

@Path("/api/clipboard")
@Produces(MediaType.APPLICATION_JSON)
public class OnlineClipBoardController {
    private final OnlineClipBoardService service;

    public OnlineClipBoardController(OnlineClipBoardService service) {
        this.service = service;
    }

    @GET
    @Path("/query")
    public Result<OnlineClipBoard> getById(@QueryParam("id") String id) {
        return Result.success(service.getById(id));
    }

    @POST
    @Path("/save")
    public Result<Void> save(OnlineClipBoard onlineClipBoard) {
        boolean success = service.save(onlineClipBoard);
        return success ? Result.success() : Result.fail(ApiError.CLIPBOARD_SAVE_FAILED.name());
    }

    @DELETE
    @Path("/delete")
    public Result<Void> delete(@QueryParam("id") String id) {
        boolean success = service.delete(id);
        return success ? Result.success() : Result.fail(ApiError.CLIPBOARD_NOT_FOUND.name());
    }
}
