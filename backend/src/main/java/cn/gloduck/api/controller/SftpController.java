package cn.gloduck.api.controller;

import cn.gloduck.api.entity.model.ssh.SshConnectRequest;
import cn.gloduck.api.entity.model.ssh.SftpTransferResult;
import cn.gloduck.api.exceptions.ApiError;
import cn.gloduck.api.exceptions.ApiException;
import cn.gloduck.api.service.ssh.SshService;
import cn.gloduck.api.utils.JsonUtils;
import cn.gloduck.api.utils.StringUtils;
import cn.gloduck.common.entity.base.Result;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DefaultValue;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.StreamingOutput;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

@Path("/api/ssh/sftp")
public class SftpController {
    private final SshService sshService;

    public SftpController(SshService sshService) {
        this.sshService = sshService;
    }

    @POST
    @Path("/upload")
    @Consumes(MediaType.APPLICATION_OCTET_STREAM)
    @Produces(MediaType.APPLICATION_JSON)
    public Result<SftpTransferResult> upload(@QueryParam("remotePath") String remotePath,
                                             @QueryParam("createDirs") @DefaultValue("false") boolean createDirs,
                                             @HeaderParam("X-Ssh-Connect") String encodedConnect,
                                             @HeaderParam("X-Ssh-Security-Key") String securityKey,
                                             @HeaderParam("X-Ssh-Host") String host,
                                             @HeaderParam("X-Ssh-Port") Integer port,
                                             @HeaderParam("X-Ssh-Username") String username,
                                             @HeaderParam("X-Ssh-Auth-Type") String authType,
                                             @HeaderParam("X-Ssh-Password") String password,
                                             @HeaderParam("X-Ssh-Private-Key") String privateKey,
                                             @HeaderParam("X-Ssh-Passphrase") String passphrase,
                                             InputStream body) {
        sshService.verify(securityKey);
        SshConnectRequest request = connectRequest(encodedConnect, host, port, username, authType, password, privateKey, passphrase);
        return Result.success(sshService.uploadSftp(request, remotePath, createDirs, body));
    }

    @GET
    @Path("/download")
    @Produces(MediaType.APPLICATION_OCTET_STREAM)
    public Response download(@QueryParam("remotePath") String remotePath,
                             @HeaderParam("X-Ssh-Connect") String encodedConnect,
                             @HeaderParam("X-Ssh-Security-Key") String securityKey,
                             @HeaderParam("X-Ssh-Host") String host,
                             @HeaderParam("X-Ssh-Port") Integer port,
                             @HeaderParam("X-Ssh-Username") String username,
                             @HeaderParam("X-Ssh-Auth-Type") String authType,
                             @HeaderParam("X-Ssh-Password") String password,
                             @HeaderParam("X-Ssh-Private-Key") String privateKey,
                             @HeaderParam("X-Ssh-Passphrase") String passphrase) {
        sshService.verify(securityKey);
        SshConnectRequest request = connectRequest(encodedConnect, host, port, username, authType, password, privateKey, passphrase);
        SshService.SftpDownload download = sshService.openSftpDownload(request, remotePath);
        StreamingOutput stream = output -> download.writeTo(output);
        return Response.ok(stream, MediaType.APPLICATION_OCTET_STREAM)
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + downloadFileName(download.remotePath()) + "\"")
                .header(HttpHeaders.CONTENT_LENGTH, download.size())
                .build();
    }

    private SshConnectRequest connectRequest(String encodedConnect,
                                             String host,
                                             Integer port,
                                             String username,
                                             String authType,
                                             String password,
                                             String privateKey,
                                             String passphrase) {
        if (!StringUtils.isNullOrEmpty(encodedConnect)) {
            try {
                return JsonUtils.readValue(decodeConnectHeader(encodedConnect), SshConnectRequest.class);
            } catch (ApiException e) {
                throw e;
            } catch (RuntimeException e) {
                throw new ApiException(ApiError.SFTP_REQUEST_INVALID, e);
            }
        }
        SshConnectRequest request = new SshConnectRequest();
        request.host = host;
        request.port = port == null ? 22 : port;
        request.username = username;
        request.authType = authType;
        request.password = password;
        request.privateKey = privateKey;
        request.passphrase = passphrase;
        return request;
    }

    private String decodeConnectHeader(String value) {
        String trimmed = value.trim();
        try {
            return new String(Base64.getUrlDecoder().decode(trimmed), StandardCharsets.UTF_8);
        } catch (IllegalArgumentException ignored) {
            try {
                return new String(Base64.getDecoder().decode(trimmed), StandardCharsets.UTF_8);
            } catch (IllegalArgumentException e) {
                throw new ApiException(ApiError.SFTP_REQUEST_INVALID, e);
            }
        }
    }

    private String downloadFileName(String remotePath) {
        String normalized = String.valueOf(remotePath).replace('\\', '/');
        int index = normalized.lastIndexOf('/');
        String fileName = index < 0 ? normalized : normalized.substring(index + 1);
        return fileName.replace("\\", "_").replace("/", "_").replace("\"", "_");
    }
}
