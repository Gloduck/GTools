package cn.gloduck.api.service.http;

import cn.gloduck.api.utils.NetUtils;
import jakarta.enterprise.context.ApplicationScoped;

import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;
import java.net.InetSocketAddress;
import java.net.ProxySelector;
import java.net.http.HttpClient;
import java.security.KeyManagementException;
import java.security.NoSuchAlgorithmException;
import java.security.cert.X509Certificate;
import java.time.Duration;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

@ApplicationScoped
public class HttpClientProvider {
    private final ConcurrentMap<HttpClientConfig, HttpClient> clients = new ConcurrentHashMap<>();

    public HttpClient getClient(Integer connectTimeout, String proxy, boolean trustAllCertificates) {
        HttpClientConfig config = buildConfig(connectTimeout, proxy, trustAllCertificates);
        return clients.computeIfAbsent(config, this::buildClient);
    }

    private HttpClientConfig buildConfig(Integer connectTimeout, String proxy, boolean trustAllCertificates) {
        int timeout = Optional.ofNullable(connectTimeout).orElse(5);
        InetSocketAddress proxyAddress = NetUtils.buildProxyAddress(proxy);
        return new HttpClientConfig(timeout, proxyAddress, trustAllCertificates);
    }

    private HttpClient buildClient(HttpClientConfig config) {
        HttpClient.Builder builder = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(config.connectTimeout));
        if (config.proxyAddress != null) {
            builder.proxy(ProxySelector.of(config.proxyAddress));
        }

        if (config.trustAllCertificates) {
            try {
                SSLContext sslContext = SSLContext.getInstance("TLS");
                sslContext.init(null, new TrustManager[]{new TrustAllManager()}, new java.security.SecureRandom());
                builder.sslContext(sslContext);
            } catch (NoSuchAlgorithmException | KeyManagementException e) {
                throw new RuntimeException(e);
            }
        }
        return builder.build();
    }

    private record HttpClientConfig(int connectTimeout, InetSocketAddress proxyAddress, boolean trustAllCertificates) {
    }

    private static class TrustAllManager implements X509TrustManager {
        @Override
        public X509Certificate[] getAcceptedIssuers() {
            return null;
        }

        @Override
        public void checkClientTrusted(X509Certificate[] certs, String authType) {
        }

        @Override
        public void checkServerTrusted(X509Certificate[] certs, String authType) {
        }
    }
}
