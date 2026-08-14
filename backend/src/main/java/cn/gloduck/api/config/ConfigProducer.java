package cn.gloduck.api.config;

import cn.gloduck.api.entity.config.GithubConfig;
import cn.gloduck.api.entity.config.JrebelConfig;
import cn.gloduck.api.entity.config.ProxyRequestConfig;
import cn.gloduck.api.entity.config.ServerConfig;
import cn.gloduck.api.entity.config.SshConfig;
import cn.gloduck.api.entity.config.TorrentConfig;
import cn.gloduck.api.entity.config.WebRtcConfig;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Produces;

@ApplicationScoped
public class ConfigProducer {
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    @Produces
    public ServerConfig serverConfig() {
        return convert(rootNode(), ServerConfig.class);
    }

    @Produces
    public JrebelConfig jrebelConfig() {
        return convert(rootNode().path("jrebel"), JrebelConfig.class);
    }

    @Produces
    public GithubConfig githubConfig() {
        return convert(rootNode().path("github"), GithubConfig.class);
    }

    @Produces
    public TorrentConfig torrentConfig() {
        return convert(rootNode().path("torrent"), TorrentConfig.class);
    }

    @Produces
    public ProxyRequestConfig proxyRequestConfig() {
        return convert(rootNode().path("proxyrequest"), ProxyRequestConfig.class);
    }

    @Produces
    public SshConfig sshConfig() {
        return convert(rootNode().path("ssh"), SshConfig.class);
    }

    /** 从配置文件的 webrtc 节点创建 WebRTC 配置对象。 */
    @Produces
    public WebRtcConfig webRtcConfig() {
        return convert(rootNode().path("webrtc"), WebRtcConfig.class);
    }

    private JsonNode rootNode() {
        return ConfigFileLoader.loadRootNode();
    }

    private <T> T convert(JsonNode node, Class<T> type) {
        try {
            return node == null || node.isMissingNode() || node.isNull()
                    ? type.getDeclaredConstructor().newInstance()
                    : objectMapper.treeToValue(node, type);
        } catch (Exception e) {
            throw new IllegalStateException("Failed to load config: " + type.getSimpleName(), e);
        }
    }
}
