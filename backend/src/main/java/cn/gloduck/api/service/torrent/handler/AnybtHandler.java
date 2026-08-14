package cn.gloduck.api.service.torrent.handler;

import cn.gloduck.api.entity.config.TorrentConfig;
import cn.gloduck.api.entity.model.torrent.TorrentInfo;
import cn.gloduck.api.service.http.HttpClientProvider;
import cn.gloduck.common.entity.base.ScrollPageResult;
import cn.gloduck.api.utils.JsonUtils;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpRequest;
import java.util.*;

public class AnybtHandler extends AbstractTorrentHandler {
    private static final int DEFAULT_PAGE_SIZE = 50;
    private static final String API_URL = "https://gw.magnode.ru/v1/sql/query";

    // SQL查询模板
    private static final String SEARCH_SQL_TEMPLATE = "select /*+ SET_VAR(full_text_option='{\"highlight\":{ \"fields\":[\"file_name\"]}}') */ file_name,filesize,total_count,_id,category,firstadd_utc_timestamp,_score from library.dht where query_string('file_name:\\\"%s\\\"^1') order by %s desc limit %d, %d";

    private static final String DETAIL_SQL_TEMPLATE = "select /*+ SET_VAR(full_text_option='{\"highlight\":{ \"fields\":[\"file_name\"]}}') */ file_name,filesize,total_count,_id,category,firstadd_utc_timestamp,_score from library.dht where _id = '%s'";

    public AnybtHandler(TorrentConfig torrentConfig, TorrentConfig.WebConfig config, HttpClientProvider httpClientProvider) {
        super(torrentConfig, config, httpClientProvider);
    }

    @Override
    public TorrentInfo queryDetail(String id) {
        // 构建SQL查询
        String sql = String.format(DETAIL_SQL_TEMPLATE, id);
        ObjectNode requestBodyJson = JsonUtils.createObjectNode();
        requestBodyJson.put("sql", sql);
        requestBodyJson.put("dataset_name", "anybt");
        requestBodyJson.set("arguments", JsonUtils.createArrayNode());
        // 构建请求体
        String requestBody = JsonUtils.writeValueAsString(requestBodyJson);

        HttpRequest request = jsonRequestBuilder(API_URL)
                .POST(HttpRequest.BodyPublishers.ofString(requestBody))
                .build();
        JsonNode response = sendJsonRequest(request);
        // 从results获取结果
        JsonNode results = response.get("result");
        if (results == null || results.isNull() || results.size() == 0) {
            return null;
        }
        JsonNode row = results.get(0).get("row");
        if (row == null) {
            return null;
        }
        return buildTorrentInfo(row);
    }

    private TorrentInfo buildTorrentInfo(JsonNode row) {
        if (row == null) {
            return null;
        }
        TorrentInfo torrentInfo = new TorrentInfo();
        String hash = row.path("_id").path("value").asText();
        torrentInfo.setId(hash);
        torrentInfo.setName(row.path("file_name").path("value").asText());
        torrentInfo.setHash(hash.toUpperCase());
        torrentInfo.setSize(row.path("filesize").path("value").asLong());
        Date uploadTime = null;
        String uploadTimeStr = row.path("firstadd_utc_timestamp").path("value").asText();
        if (uploadTimeStr != null) {
            uploadTime = new Date(new BigDecimal(uploadTimeStr).multiply(BigDecimal.valueOf(1000)).longValue());
        }
        torrentInfo.setUploadTime(uploadTime);
        return torrentInfo;
    }

    @Override
    public ScrollPageResult<TorrentInfo> search(String keyword, Long index, String sortField, String sortOrder) {
        int offset = (int) ((index - 1) * DEFAULT_PAGE_SIZE);

        String sortColumn = convertSortColumn(sortField);

        // 构建SQL查询
        String escapedKeyword = keyword.replace("'", "\\'");
        // 增加1个结果, 用于判断是否有下一页
        String sql = String.format(SEARCH_SQL_TEMPLATE, escapedKeyword, sortColumn, offset, DEFAULT_PAGE_SIZE + 1);
        ObjectNode requestBodyJson = JsonUtils.createObjectNode();
        requestBodyJson.put("sql", sql);
        requestBodyJson.put("dataset_name", "anybt");
        requestBodyJson.set("arguments", JsonUtils.createArrayNode());
        // 构建请求体
        String requestBody = JsonUtils.writeValueAsString(requestBodyJson);

        HttpRequest request = jsonRequestBuilder(API_URL)
                .POST(HttpRequest.BodyPublishers.ofString(requestBody))
                .build();
        JsonNode response = sendJsonRequest(request);
        // 从results获取结果
        JsonNode results = response.get("result");
        boolean hasMore = false;
        List<TorrentInfo> torrentInfos = new ArrayList<>();
        if (results != null) {
            for (JsonNode node : results) {
                JsonNode row = node.get("row");
                if (row == null) {
                    continue;
                }
                TorrentInfo torrentInfo = buildTorrentInfo(row);
                if (torrentInfos.size() == DEFAULT_PAGE_SIZE) {
                    hasMore = true;
                } else {
                    torrentInfos.add(torrentInfo);
                }
            }
        }
        return new ScrollPageResult<>(index, hasMore, torrentInfos);
    }

    private String convertSortColumn(String sortFiled) {
        if (sortFiled == null) {
            return "total_count";
        }
        return switch (sortFiled) {
            case "relevance" -> "_score";
            case "uploadTime", "" -> "firstadd_utc_timestamp";
            case "size" -> "filesize";
            default -> "total_count";
        };
    }

    @Override
    public List<String> sortFields() {
        return Arrays.asList("relevance", "uploadTime", "size");
    }

    @Override
    public String code() {
        return "anybt";
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
