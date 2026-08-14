package cn.gloduck.api.service.torrent.handler;

import cn.gloduck.api.entity.config.TorrentConfig;
import cn.gloduck.api.exceptions.ApiError;
import cn.gloduck.api.exceptions.ApiException;
import cn.gloduck.api.service.http.HttpClientProvider;
import cn.gloduck.api.utils.JsonUtils;
import com.fasterxml.jackson.databind.JsonNode;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Optional;
import java.util.logging.Logger;

public abstract class AbstractTorrentHandler implements TorrentHandler {
    protected final static Logger LOGGER = Logger.getLogger(AbstractTorrentHandler.class.getName());

    private static final String AVAILABLE_CHECK_KEYWORD = "1080p";

    private final HttpClientProvider httpClientProvider;

    private final String proxy;

    private final boolean trustAllCertificates;

    protected final String baseUrl;

    private final String bypassCfApi;

    private final String bypassCfApiProxy;

    private final int requestTimeout;

    @Override
    public String url() {
        return baseUrl;
    }

    @Override
    public boolean checkAvailable() {
        try {
            search(AVAILABLE_CHECK_KEYWORD, 1L, null, null);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    protected boolean sortReverse(String order) {
        return "desc".equalsIgnoreCase(order);
    }

    public JsonNode sendJsonRequest(HttpRequest request) {
        String body = null;
        try {
            HttpResponse<String> response = getHttpClient().send(request, new StringBodyHandler());
            body = response.body();
            if (response.statusCode() != 200) {
                throw new RuntimeException(String.format("Server response error code: %s, response: %s", response.statusCode(), response.body()));
            }
            return JsonUtils.readTree(body);
        } catch (Exception e) {
            LOGGER.warning(String.format("Request [%s] Error: %s, response: %s", request.uri(), e.getMessage(), body));
            throw new ApiException(ApiError.TORRENT_REQUEST_FAILED, e);
        }
    }

    public String sendPlainTextRequest(HttpRequest request) {
        String body = null;
        try {
            HttpResponse<String> response = getHttpClient().send(request, new StringBodyHandler());
            body = response.body();
            if (response.statusCode() != 200) {
                throw new RuntimeException(String.format("Server response error code: %s, response: %s", response.statusCode(), response.body()));
            }
            return body;
        } catch (Exception e) {
            LOGGER.warning(String.format("Request [%s] Error: %s, response: %s", request.uri(), e.getMessage(), body));
            throw new ApiException(ApiError.TORRENT_REQUEST_FAILED, e);
        }
    }

    protected HttpRequest.Builder requestBuilder(String url) {
        return requestBuilder(url, requestTimeout);
    }

    protected HttpRequest.Builder requestBuilder(String url, int timeout) {
        if (bypassCfApi != null) {
            URI originalUri = URI.create(url);
            String path = originalUri.getRawPath();
            StringBuilder requestUrlBuilder = new StringBuilder(bypassCfApi);
            if (path != null && !path.isEmpty()) {
                requestUrlBuilder.append(path);
            }
            String query = originalUri.getRawQuery();
            if (query != null && !query.isEmpty()) {
                requestUrlBuilder.append("?").append(query);
            }
            String requestUrl = requestUrlBuilder.toString();
            HttpRequest.Builder builder = HttpRequest.newBuilder()
                    .timeout(Duration.ofSeconds(requestTimeout))
                    .uri(URI.create(requestUrl));
            builder.header("x-hostname", originalUri.getHost());
            if (bypassCfApiProxy != null) {
                builder.header("x-proxy", bypassCfApiProxy);
            }
            return builder;
        } else {
            return HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .timeout(java.time.Duration.ofSeconds(requestTimeout));
        }
    }

    protected HttpRequest.Builder jsonRequestBuilder(String requestUrl) {
        return requestBuilder(requestUrl)
                .header("Content-Type", "application/json")
                .header("Accept", "application/json");
    }


    protected HttpClient getHttpClient() {
        return httpClientProvider.getClient(5, proxy, trustAllCertificates);
    }

    public AbstractTorrentHandler(TorrentConfig torrentConfig, TorrentConfig.WebConfig config, HttpClientProvider httpClientProvider) {
        this.baseUrl = config.url;
        this.requestTimeout = Optional.ofNullable(config.requestTimeout).orElse(5);
        String bypassCfApi = null;
        String bypassCfApiProxy = null;
        boolean bypassCf = Boolean.TRUE.equals(config.bypassCf);
        if (bypassCf) {
            bypassCfApi = (torrentConfig.bypassCfApi != null && !torrentConfig.bypassCfApi.isEmpty()) ? torrentConfig.bypassCfApi : null;
            boolean useProxy = Boolean.TRUE.equals(config.useProxy);
            if (useProxy) {
                bypassCfApiProxy = (torrentConfig.bypassCfApiProxy != null && !torrentConfig.bypassCfApiProxy.isEmpty()) ? torrentConfig.bypassCfApiProxy : null;
            }
        }
        this.bypassCfApi = bypassCfApi;
        this.bypassCfApiProxy = bypassCfApiProxy;
        this.httpClientProvider = httpClientProvider;
        boolean useProxy = Boolean.TRUE.equals(config.useProxy) && !bypassCf;
        this.proxy = useProxy ? torrentConfig.proxy : null;
        this.trustAllCertificates = Boolean.TRUE.equals(config.trustAllCertificates);
    }

}
