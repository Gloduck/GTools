package cn.gloduck.api.exceptions;

import cn.gloduck.common.entity.base.Result;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;

@Provider
public class ApiExceptionMapper implements ExceptionMapper<ApiException> {
    @Override
    public Response toResponse(ApiException exception) {
        return Response.ok(Result.fail(exception.getError().name()), MediaType.APPLICATION_JSON).build();
    }
}
