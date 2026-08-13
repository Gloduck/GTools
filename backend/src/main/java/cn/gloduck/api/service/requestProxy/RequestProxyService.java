package cn.gloduck.api.service.requestProxy;

import cn.gloduck.api.entity.config.ProxyRequestConfig;
import cn.gloduck.api.exceptions.ApiError;
import cn.gloduck.api.exceptions.ApiException;
import cn.gloduck.api.utils.NetUtils;
import cn.gloduck.api.utils.StringUtils;
import cn.gloduck.common.entity.base.Result;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.MultivaluedHashMap;
import jakarta.ws.rs.core.MultivaluedMap;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.StreamingOutput;
import jakarta.ws.rs.core.UriInfo;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ProxySelector;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.UnknownHostException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@ApplicationScoped
public class RequestProxyService {
    private static final int MAX_REDIRECTS = 5;
    private static final String PROXY_HOST_KEY = "X-Proxy-Host";
    private static final String PROXY_CORS_KEY = "X-Proxy-Cors";
    private static final String PROXY_FOLLOW_REDIRECT_KEY = "X-Proxy-Follow-Redirect";
    private static final String PROXY_ORIGIN_KEY = "X-Proxy-Origin";
    private static final String PROXY_REFERER_KEY = "X-Proxy-Referer";
    private static final String SEC_FETCH_HEADER_PREFIX = "Sec-Fetch-";
    private static final Set<String> IGNORE_REQUEST_PARAMETERS = new LinkedHashSet<>(Arrays.asList(
            PROXY_HOST_KEY,
            PROXY_CORS_KEY,
            PROXY_FOLLOW_REDIRECT_KEY,
            PROXY_ORIGIN_KEY,
            PROXY_REFERER_KEY));
    private static final Set<String> IGNORE_REQUEST_HEADERS = new LinkedHashSet<>(Arrays.asList(
            "Host",
            "Connection",
            "Content-Length",
            "Transfer-Encoding",
            "Upgrade",
            "Expect",
            "Origin",
            "Referer",
            PROXY_HOST_KEY,
            PROXY_CORS_KEY,
            PROXY_FOLLOW_REDIRECT_KEY,
            PROXY_ORIGIN_KEY,
            PROXY_REFERER_KEY));
    private static final Set<String> IGNORE_CROSS_ORIGIN_REDIRECT_HEADERS = new LinkedHashSet<>(Arrays.asList(
            "Authorization",
            "Cookie"));
    private static final Set<String> IGNORE_RESPONSE_HEADERS = new LinkedHashSet<>(Arrays.asList(
            "Connection",
            "Content-Length",
            "Transfer-Encoding"));

    private final HttpClient httpClient;
    private final boolean allowPrivateNetwork;

    public RequestProxyService(ProxyRequestConfig config) {
        this.httpClient = buildHttpClient(config);
        this.allowPrivateNetwork = config.allowPrivateNetwork;
    }

    public Response options(String path, HttpHeaders headers, UriInfo uriInfo) {
        MultivaluedMap<String, String> query = uriInfo.getQueryParameters();
        boolean enableCors = isCorsEnabled(headers, query);
        if (enableCors) {
            return withCors(Response.noContent()).build();
        }
        return proxy("OPTIONS", path, null, headers, uriInfo);
    }

    public Response proxy(String method, String path, InputStream body, HttpHeaders headers, UriInfo uriInfo) {
        MultivaluedMap<String, String> query = uriInfo.getQueryParameters();
        boolean enableCors = isCorsEnabled(headers, query);
        String proxyHost = getProxyHost(headers, query);
        if (StringUtils.isNullOrEmpty(proxyHost)) {
            return localError(Response.Status.BAD_REQUEST, ApiError.PROXY_HOST_REQUIRED, enableCors);
        }

        HttpResponse<InputStream> response;
        try {
            ProxyRequestOptions options = new ProxyRequestOptions(
                    isRedirectEnabled(headers, query),
                    isProxyHeaderEnabled(headers, query, PROXY_ORIGIN_KEY),
                    isProxyHeaderEnabled(headers, query, PROXY_REFERER_KEY));
            String scheme = resolveRequestScheme(headers, proxyHost);
            URI targetUri = buildTargetUri(proxyHost, scheme, path, filterRequestParameters(query));
            response = sendRequest(method, body, headers, targetUri, options);
        } catch (URISyntaxException e) {
            return localError(Response.Status.BAD_REQUEST, ApiError.PROXY_TARGET_INVALID, enableCors);
        } catch (ApiException e) {
            return localError(Response.Status.BAD_REQUEST, e.getError(), enableCors);
        } catch (IllegalArgumentException e) {
            return localError(Response.Status.BAD_REQUEST, ApiError.PROXY_TARGET_INVALID, enableCors);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return localError(Response.Status.INTERNAL_SERVER_ERROR, ApiError.PROXY_REQUEST_FAILED, enableCors);
        } catch (IOException e) {
            return localError(Response.Status.BAD_GATEWAY, ApiError.PROXY_REQUEST_FAILED, enableCors);
        }

        Response.ResponseBuilder responseBuilder = Response.status(response.statusCode());
        copyResponseHeaders(response.headers().map(), responseBuilder);
        if (enableCors) {
            withCors(responseBuilder);
        }
        StreamingOutput output = out -> copyAndClose(response.body(), out);
        return responseBuilder.entity(output).build();
    }

    private Response localError(Response.Status status, ApiError error, boolean enableCors) {
        Response.ResponseBuilder builder = Response.status(status)
                .type(MediaType.APPLICATION_JSON)
                .entity(Result.fail(error.name()));
        if (enableCors) {
            withCors(builder);
        }
        return builder.build();
    }

    private HttpResponse<InputStream> sendRequest(String method, InputStream body, HttpHeaders headers, URI targetUri,
                                                   ProxyRequestOptions options)
            throws IOException, InterruptedException {
        String currentMethod = method;
        boolean hasBody = body != null && !"GET".equals(method) && !"HEAD".equals(method);
        HttpRequest.BodyPublisher currentBody = buildRequestBodyPublisher(method, body, headers);
        boolean includeSensitiveHeaders = true;
        int redirectCount = 0;

        while (true) {
            validateTargetUri(targetUri);
            HttpRequest.Builder requestBuilder = HttpRequest.newBuilder(targetUri)
                    .method(currentMethod, currentBody);
            copyRequestHeaders(headers.getRequestHeaders(), requestBuilder, includeSensitiveHeaders);
            applyProxyRequestHeaders(requestBuilder, targetUri, options);
            HttpResponse<InputStream> response = httpClient.send(
                    requestBuilder.build(), HttpResponse.BodyHandlers.ofInputStream());

            String location = response.headers().firstValue("Location").orElse(null);
            if (!options.followRedirect()
                    || !isRedirectStatus(response.statusCode())
                    || StringUtils.isNullOrEmpty(location)) {
                return response;
            }

            URI redirectUri;
            try {
                redirectUri = targetUri.resolve(location);
            } catch (IllegalArgumentException e) {
                closeResponseBody(response);
                throw new ApiException(ApiError.PROXY_TARGET_INVALID, e);
            }
            if (!canRedirect(targetUri, redirectUri)) {
                return response;
            }
            if (redirectCount >= MAX_REDIRECTS) {
                return response;
            }

            String nextMethod = resolveRedirectMethod(response.statusCode(), currentMethod);
            if (hasBody && currentMethod.equals(nextMethod)) {
                closeResponseBody(response);
                throw new ApiException(ApiError.PROXY_REDIRECT_BODY_UNSUPPORTED);
            }

            closeResponseBody(response);
            if (!isSameOrigin(targetUri, redirectUri)) {
                includeSensitiveHeaders = false;
            }
            targetUri = redirectUri;
            currentMethod = nextMethod;
            if (hasBody) {
                currentBody = HttpRequest.BodyPublishers.noBody();
                hasBody = false;
            }
            redirectCount++;
        }
    }

    private void validateTargetUri(URI targetUri) {
        String scheme = targetUri.getScheme();
        if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) {
            throw new IllegalArgumentException("Only HTTP and HTTPS proxy targets are supported");
        }
        if (targetUri.getRawUserInfo() != null) {
            throw new IllegalArgumentException("Proxy target user info is not allowed");
        }

        String host = targetUri.getHost();
        if (StringUtils.isNullOrEmpty(host)) {
            throw new IllegalArgumentException("Proxy target host is invalid");
        }

        InetAddress[] addresses;
        try {
            addresses = InetAddress.getAllByName(host);
        } catch (UnknownHostException e) {
            throw new IllegalArgumentException("Unable to resolve proxy target host", e);
        }
        if (addresses.length == 0) {
            throw new IllegalArgumentException("Unable to resolve proxy target host");
        }
        if (!allowPrivateNetwork) {
            for (InetAddress address : addresses) {
                if (!isPublicAddress(address)) {
                    throw new IllegalArgumentException("Access to non-public proxy targets is not allowed");
                }
            }
        }
    }

    static boolean isPublicAddress(InetAddress address) {
        if (address.isAnyLocalAddress()
                || address.isLoopbackAddress()
                || address.isLinkLocalAddress()
                || address.isSiteLocalAddress()
                || address.isMulticastAddress()) {
            return false;
        }

        byte[] bytes = address.getAddress();
        if (address instanceof Inet4Address) {
            return isPublicIpv4Address(bytes);
        }
        if (address instanceof Inet6Address) {
            // 当前全球可路由的 IPv6 单播地址范围是 2000::/3，同时排除其中的
            // 文档、过渡机制及其他特殊用途地址段。
            return matchesPrefix(bytes, new byte[]{0x20}, 3)
                    && !matchesPrefix(bytes, new byte[]{0x20, 0x01, 0x00}, 23)
                    && !matchesPrefix(bytes, new byte[]{0x20, 0x01, 0x0d, (byte) 0xb8}, 32)
                    && !matchesPrefix(bytes, new byte[]{0x20, 0x02}, 16);
        }
        return false;
    }

    private static boolean isPublicIpv4Address(byte[] bytes) {
        int first = Byte.toUnsignedInt(bytes[0]);
        int second = Byte.toUnsignedInt(bytes[1]);
        int third = Byte.toUnsignedInt(bytes[2]);

        // 本网络 0.0.0.0/8、私有网络 10.0.0.0/8、回环地址 127.0.0.0/8、
        // 多播地址 224.0.0.0/4 及保留地址 240.0.0.0/4。
        if (first == 0 || first == 10 || first == 127 || first >= 224) {
            return false;
        }
        // 运营商级 NAT 地址段：100.64.0.0/10。
        if (first == 100 && second >= 64 && second <= 127) {
            return false;
        }
        // 链路本地地址段，其中包含常见的云元数据服务地址：169.254.0.0/16。
        if (first == 169 && second == 254) {
            return false;
        }
        // 私有网络地址段：172.16.0.0/12。
        if (first == 172 && second >= 16 && second <= 31) {
            return false;
        }
        // IETF 协议分配及文档地址段：192.0.0.0/24、192.0.2.0/24。
        if (first == 192 && second == 0 && (third == 0 || third == 2)) {
            return false;
        }
        // 已废弃的 6to4 中继任播地址段：192.88.99.0/24。
        if (first == 192 && second == 88 && third == 99) {
            return false;
        }
        // 私有网络地址段：192.168.0.0/16。
        if (first == 192 && second == 168) {
            return false;
        }
        // 网络基准测试地址段：198.18.0.0/15。
        if (first == 198 && (second == 18 || second == 19)) {
            return false;
        }
        // 文档地址段：198.51.100.0/24。
        if (first == 198 && second == 51 && third == 100) {
            return false;
        }
        // 文档地址段：203.0.113.0/24。
        return first != 203 || second != 0 || third != 113;
    }

    private static boolean matchesPrefix(byte[] address, byte[] prefix, int prefixBits) {
        int fullBytes = prefixBits / 8;
        for (int i = 0; i < fullBytes; i++) {
            if (address[i] != prefix[i]) {
                return false;
            }
        }

        int remainingBits = prefixBits % 8;
        if (remainingBits == 0) {
            return true;
        }
        int mask = 0xff << (8 - remainingBits);
        return (address[fullBytes] & mask) == (prefix[fullBytes] & mask);
    }

    private boolean isRedirectStatus(int statusCode) {
        return statusCode == 301
                || statusCode == 302
                || statusCode == 303
                || statusCode == 307
                || statusCode == 308;
    }

    private String resolveRedirectMethod(int statusCode, String method) {
        if (statusCode == 303) {
            return "GET";
        }
        if ((statusCode == 301 || statusCode == 302) && "POST".equals(method)) {
            return "GET";
        }
        return method;
    }

    private boolean canRedirect(URI currentUri, URI redirectUri) {
        String currentScheme = currentUri.getScheme();
        String redirectScheme = redirectUri.getScheme();
        return redirectScheme.equalsIgnoreCase(currentScheme) || "https".equalsIgnoreCase(redirectScheme);
    }

    private boolean isSameOrigin(URI currentUri, URI redirectUri) {
        return currentUri.getScheme().equalsIgnoreCase(redirectUri.getScheme())
                && currentUri.getRawAuthority().equals(redirectUri.getRawAuthority());
    }

    private void closeResponseBody(HttpResponse<InputStream> response) throws IOException {
        if (response.body() != null) {
            response.body().close();
        }
    }

    private HttpRequest.BodyPublisher buildRequestBodyPublisher(String method, InputStream body, HttpHeaders headers) {
        if (body == null || "GET".equals(method) || "HEAD".equals(method)) {
            return HttpRequest.BodyPublishers.noBody();
        }
        HttpRequest.BodyPublisher publisher = HttpRequest.BodyPublishers.ofInputStream(() -> body);
        long contentLength = resolveContentLength(headers);
        return contentLength >= 0 ? HttpRequest.BodyPublishers.fromPublisher(publisher, contentLength) : publisher;
    }

    private long resolveContentLength(HttpHeaders headers) {
        String contentLength = getFirstHeader(headers, "Content-Length");
        if (StringUtils.isNullOrEmpty(contentLength)) {
            return -1;
        }
        try {
            return Long.parseLong(contentLength);
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    private URI buildTargetUri(String proxyHost, String scheme, String path, MultivaluedMap<String, String> query)
            throws URISyntaxException {
        String authority = proxyHost;
        int schemeIndex = proxyHost.indexOf("://");
        if (schemeIndex > 0) {
            authority = proxyHost.substring(schemeIndex + 3);
        }
        String targetPath = path == null || path.isEmpty() ? "/" : "/" + path;
        URI targetOrigin = new URI(scheme, authority, null, null, null);
        String rawQuery = new URI(null, null, null, buildQuery(query), null).getRawQuery();
        String target = targetOrigin.toASCIIString() + targetPath;
        return new URI(rawQuery == null ? target : target + "?" + rawQuery);
    }

    private String buildQuery(MultivaluedMap<String, String> query) {
        if (query == null || query.isEmpty()) {
            return null;
        }
        StringBuilder builder = new StringBuilder();
        query.forEach((key, values) -> {
            for (String value : values) {
                if (builder.length() > 0) {
                    builder.append('&');
                }
                builder.append(key);
                if (value != null) {
                    builder.append('=').append(value);
                }
            }
        });
        return builder.toString();
    }

    private String resolveRequestScheme(HttpHeaders headers, String proxyHost) {
        int schemeIndex = proxyHost.indexOf("://");
        if (schemeIndex > 0) {
            return proxyHost.substring(0, schemeIndex);
        }
        String forwardedProto = getFirstHeader(headers, "X-Forwarded-Proto");
        return StringUtils.isNullOrEmpty(forwardedProto) ? "http" : forwardedProto;
    }

    private MultivaluedMap<String, String> filterRequestParameters(MultivaluedMap<String, String> requestParameters) {
        MultivaluedMap<String, String> filteredParameters = new MultivaluedHashMap<>();
        requestParameters.forEach((key, values) -> {
            if (!IGNORE_REQUEST_PARAMETERS.contains(key)) {
                filteredParameters.put(key, values);
            }
        });
        return filteredParameters;
    }

    private void copyRequestHeaders(MultivaluedMap<String, String> headers, HttpRequest.Builder requestBuilder,
                                    boolean includeSensitiveHeaders) {
        headers.forEach((header, values) -> {
            if (header.regionMatches(true, 0, SEC_FETCH_HEADER_PREFIX, 0, SEC_FETCH_HEADER_PREFIX.length())
                    || shouldIgnoreHeader(header, IGNORE_REQUEST_HEADERS)
                    || (!includeSensitiveHeaders
                    && shouldIgnoreHeader(header, IGNORE_CROSS_ORIGIN_REDIRECT_HEADERS))) {
                return;
            }
            for (String value : values) {
                requestBuilder.header(header, value);
            }
        });
    }

    private void applyProxyRequestHeaders(HttpRequest.Builder requestBuilder, URI targetUri,
                                          ProxyRequestOptions options) {
        String targetOrigin = buildTargetOrigin(targetUri);
        if (options.useTargetOrigin()) {
            requestBuilder.header("Origin", targetOrigin);
        }
        if (options.useTargetReferer()) {
            requestBuilder.header("Referer", targetOrigin + "/");
        }
    }

    private void copyResponseHeaders(Map<String, List<String>> sourceHeaders, Response.ResponseBuilder responseBuilder) {
        sourceHeaders.forEach((header, values) -> {
            if (shouldIgnoreHeader(header, IGNORE_RESPONSE_HEADERS)) {
                return;
            }
            for (String value : values) {
                responseBuilder.header(header, value);
            }
        });
    }

    private Response.ResponseBuilder withCors(Response.ResponseBuilder responseBuilder) {
        return responseBuilder
                .header("Access-Control-Allow-Origin", "*")
                .header("Access-Control-Allow-Methods", "*")
                .header("Access-Control-Allow-Headers", "*")
                .header("Access-Control-Expose-Headers", "*");
    }

    private boolean isCorsEnabled(HttpHeaders headers, MultivaluedMap<String, String> queryParameters) {
        String explicitEnabled = getFirstHeader(headers, PROXY_CORS_KEY);
        if (StringUtils.isNullOrEmpty(explicitEnabled)) {
            explicitEnabled = queryParameters.getFirst(PROXY_CORS_KEY);
        }
        return isTruthy(explicitEnabled);
    }

    private boolean isRedirectEnabled(HttpHeaders headers, MultivaluedMap<String, String> queryParameters) {
        String explicitEnabled = getFirstHeader(headers, PROXY_FOLLOW_REDIRECT_KEY);
        if (StringUtils.isNullOrEmpty(explicitEnabled)) {
            explicitEnabled = queryParameters.getFirst(PROXY_FOLLOW_REDIRECT_KEY);
        }
        return isTruthy(explicitEnabled);
    }

    private String getProxyHost(HttpHeaders headers, MultivaluedMap<String, String> queryParameters) {
        String explicitHost = getFirstHeader(headers, PROXY_HOST_KEY);
        if (StringUtils.isNullOrEmpty(explicitHost)) {
            explicitHost = queryParameters.getFirst(PROXY_HOST_KEY);
        }
        return explicitHost;
    }

    private String getFirstHeader(HttpHeaders headers, String name) {
        List<String> values = headers.getRequestHeader(name);
        return values == null || values.isEmpty() ? null : values.get(0);
    }

    private boolean shouldIgnoreHeader(String header, Set<String> ignoredHeaders) {
        return ignoredHeaders.stream().anyMatch(ignored -> ignored.equalsIgnoreCase(header));
    }

    private boolean isProxyHeaderEnabled(HttpHeaders headers, MultivaluedMap<String, String> queryParameters,
                                         String key) {
        String value = getFirstHeader(headers, key);
        if (StringUtils.isNullOrEmpty(value)) {
            value = queryParameters.getFirst(key);
        }
        return isTruthy(value);
    }

    private static String buildTargetOrigin(URI targetUri) {
        return targetUri.getScheme() + "://" + targetUri.getRawAuthority();
    }

    private boolean isTruthy(String value) {
        return "true".equalsIgnoreCase(value) || "1".equals(value) || "yes".equalsIgnoreCase(value);
    }

    private void copyAndClose(InputStream inputStream, OutputStream outputStream) throws IOException {
        try (InputStream in = inputStream) {
            if (in == null) {
                return;
            }
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) != -1) {
                outputStream.write(buffer, 0, read);
            }
        }
    }

    private HttpClient buildHttpClient(ProxyRequestConfig config) {
        String proxy = config.proxy;
        InetSocketAddress proxyAddress = NetUtils.buildProxyAddress(StringUtils.isNullOrEmpty(proxy) ? null : proxy);
        HttpClient.Builder builder = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .followRedirects(HttpClient.Redirect.NEVER);
        if (proxyAddress != null) {
            builder.proxy(ProxySelector.of(proxyAddress));
        }
        return builder.build();
    }

    private record ProxyRequestOptions(boolean followRedirect, boolean useTargetOrigin, boolean useTargetReferer) {
    }
}
