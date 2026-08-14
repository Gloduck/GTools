package cn.gloduck.api.service.torrent.handler;

import cn.gloduck.api.entity.config.TorrentConfig;
import cn.gloduck.api.service.http.HttpClientProvider;

import java.util.Arrays;
import java.util.List;

public class NyaaSiHandler extends AbstractNyaaSiHandler{
    public NyaaSiHandler(TorrentConfig torrentConfig, TorrentConfig.WebConfig config, HttpClientProvider httpClientProvider) {
        super(torrentConfig, config, httpClientProvider);
    }

    @Override
    public String code() {
        return "nyaa.si";
    }

    @Override
    public List<String> tags() {
        return Arrays.asList("ACG");
    }
}
