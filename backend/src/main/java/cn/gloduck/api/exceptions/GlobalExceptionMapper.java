package cn.gloduck.api.exceptions;

import cn.gloduck.common.entity.base.Result;
import jakarta.ws.rs.WebApplicationException;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;
import org.jboss.logging.Logger;

@Provider
public class GlobalExceptionMapper implements ExceptionMapper<Throwable> {
    private static final Logger LOG = Logger.getLogger(GlobalExceptionMapper.class);

    /** 保留框架 HTTP 异常的原始响应，仅将未处理异常转换为统一内部错误。 */
    @Override
    public Response toResponse(Throwable exception) {
        if (exception instanceof WebApplicationException webApplicationException) {
            return webApplicationException.getResponse();
        }
        LOG.error("Unhandled request error", exception);
        return Response.ok(Result.error(ApiError.INTERNAL_SERVER_ERROR.name()), MediaType.APPLICATION_JSON).build();
    }
}
