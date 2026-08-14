package cn.gloduck.api.service.torrent.handler;

import cn.gloduck.api.entity.config.TorrentConfig;
import cn.gloduck.api.entity.model.torrent.TorrentFileInfo;
import cn.gloduck.api.entity.model.torrent.TorrentInfo;
import cn.gloduck.api.service.http.HttpClientProvider;
import cn.gloduck.common.entity.base.ScrollPageResult;
import com.fasterxml.jackson.databind.JsonNode;

import java.net.URI;
import java.net.http.HttpRequest;
import java.util.*;
import java.util.logging.Logger;

public class BtsowHandler extends AbstractTorrentHandler {
    private static final int DEFAULT_PAGE_SIZE = 100;

    public BtsowHandler(TorrentConfig torrentConfig, TorrentConfig.WebConfig config, HttpClientProvider httpClientProvider) {
        super(torrentConfig, config, httpClientProvider);
    }

    @Override
    public TorrentInfo queryDetail(String id) {
        String requestUrl = baseUrl + "/bts/data/api/magnet";
        String requestBody = String.format("[\"%s\"]", id);
        HttpRequest request = jsonRequestBuilder(requestUrl)
                .POST(HttpRequest.BodyPublishers.ofString(requestBody))
                .build();
        JsonNode response = sendJsonRequest(request);
        JsonNode data = response.get("data");
        TorrentInfo torrentInfo = new TorrentInfo();
        String name = data.get("name").asText();
        String hash = data.get("hash").asText();
        Long size = data.get("size").asLong();
        Date lastUpdateTime = new Date(data.get("lastUpdateTime").asLong() * 1000);
        torrentInfo.setId(hash);
        torrentInfo.setName(name);
        torrentInfo.setHash(hash);
        torrentInfo.setSize(size);
        torrentInfo.setUploadTime(lastUpdateTime);

        JsonNode filesNode = data.get("files");
        List<TorrentFileInfo> files = new ArrayList<>();
        torrentInfo.setFileCount((long) filesNode.size());
        torrentInfo.setFiles(files);
        for (int i = 0; i < filesNode.size(); i++) {
            JsonNode fileNode = filesNode.get(i);
            String fileName = fileNode.get("filename").asText();
            Long fileSize = fileNode.get("size").asLong();
            TorrentFileInfo torrentFileInfo = new TorrentFileInfo();
            torrentFileInfo.setName(fileName);
            torrentFileInfo.setSize(fileSize);
            files.add(torrentFileInfo);
        }
        return torrentInfo;
    }

    @Override
    public ScrollPageResult<TorrentInfo> search(String keyword, Long index, String sortField, String sortOrder) {
        String requestBody = String.format("[{\"search\": \"%s\"},%s,%s]", keyword, DEFAULT_PAGE_SIZE, index);
        String requestUrl = baseUrl + "/bts/data/api/search";
        HttpRequest request = jsonRequestBuilder(requestUrl)
                .POST(HttpRequest.BodyPublishers.ofString(requestBody))
                .build();
        JsonNode response = sendJsonRequest(request);
        JsonNode datas = response.get("data");
        ArrayList<TorrentInfo> torrentInfos = new ArrayList<>(pageSize());
        for (int i = 0; i < datas.size(); i++) {
            JsonNode data = datas.get(i);
            String name = data.get("name").asText().replace("<em>", "").replace("</em>", "");
            String hash = data.get("hash").asText();
            Long size = data.get("size").asLong();
            Date lastUpdateTime = new Date(data.get("lastUpdateTime").asLong() * 1000);
            TorrentInfo torrentInfo = new TorrentInfo();
            torrentInfo.setId(hash);
            torrentInfo.setName(name);
            torrentInfo.setHash(hash);
            torrentInfo.setSize(size);
            torrentInfo.setUploadTime(lastUpdateTime);
            torrentInfos.add(torrentInfo);
        }
        boolean hasNext = torrentInfos.size() == DEFAULT_PAGE_SIZE;
        return new ScrollPageResult<>(index, hasNext, torrentInfos);
    }

    @Override
    public List<String> sortFields() {
        return Collections.emptyList();
    }

    @Override
    public String code() {
        return "btsow";
    }

    @Override
    public List<String> tags() {
        return Arrays.asList("ALL");
    }

    @Override
    public int pageSize() {
        return DEFAULT_PAGE_SIZE;
    }
}
