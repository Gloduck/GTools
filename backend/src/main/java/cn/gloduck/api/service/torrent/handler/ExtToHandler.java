package cn.gloduck.api.service.torrent.handler;

import cn.gloduck.api.entity.config.TorrentConfig;
import cn.gloduck.api.entity.model.torrent.TorrentFileInfo;
import cn.gloduck.api.entity.model.torrent.TorrentInfo;
import cn.gloduck.api.exceptions.ApiError;
import cn.gloduck.api.exceptions.ApiException;
import cn.gloduck.api.service.http.HttpClientProvider;
import cn.gloduck.api.utils.NetUtils;
import cn.gloduck.api.utils.Patterns;
import cn.gloduck.api.utils.UnitUtils;
import cn.gloduck.common.entity.base.ScrollPageResult;
import com.fasterxml.jackson.databind.JsonNode;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;

import java.net.http.HttpRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class ExtToHandler extends AbstractTorrentHandler {
    private static final int DEFAULT_PAGE_SIZE = 50;

    private static final Pattern TIME_PATTERN = Pattern.compile(".*?(\\d+)\\s+(second|minute|hour|day|month|year)s?.*", Pattern.CASE_INSENSITIVE);
    private static final Pattern PAGE_TOKEN_PATTERN = Pattern.compile("window\\.pageToken\\s*=\\s*'([^']+)';?", Pattern.CASE_INSENSITIVE);
    private static final Pattern CSRF_TOKEN_PATTERN = Pattern.compile("window\\.csrfToken\\s*=\\s*'([^']+)';?", Pattern.CASE_INSENSITIVE);

    public static String computeHMAC(String torrentId, long timestamp, String token) {
        String data = torrentId + "|" + Long.toString(timestamp) + "|" + token;

        MessageDigest digest = null;
        try {
            digest = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException("Failed to get SHA-256 MessageDigest instance", e);
        }
        byte[] hashBytes = digest.digest(data.getBytes(StandardCharsets.UTF_8));

        return bytesToHex(hashBytes);
    }

    private static String bytesToHex(byte[] bytes) {
        StringBuilder hexString = new StringBuilder();
        for (byte b : bytes) {
            // 转换为两位十六进制，不足补0
            String hex = Integer.toHexString(0xff & b);
            if (hex.length() == 1) {
                hexString.append('0');
            }
            hexString.append(hex);
        }
        return hexString.toString();
    }

    public static Date parseTime(String strIncludeTime) {
        Date date = null;
        if (strIncludeTime == null || strIncludeTime.isBlank()) {
            return date;
        }

        Matcher matcher = TIME_PATTERN.matcher(strIncludeTime.trim());
        if (!matcher.matches()) {
            return date;
        }

        try {
            long amount = Long.parseLong(matcher.group(1));
            String unit = matcher.group(2).toLowerCase();

            ChronoUnit chronoUnit = switch (unit) {
                case "second" -> ChronoUnit.SECONDS;
                case "minute" -> ChronoUnit.MINUTES;
                case "hour" -> ChronoUnit.HOURS;
                case "day" -> ChronoUnit.DAYS;
                case "month" -> ChronoUnit.MONTHS;
                case "year" -> ChronoUnit.YEARS;
                default -> null;
            };

            if (chronoUnit != null) {
                ZonedDateTime now = ZonedDateTime.now();
                ZonedDateTime targetTime = now.minus(amount, chronoUnit);
                date = Date.from(targetTime.toInstant());
            }

        } catch (NumberFormatException ignore) {
        }
        return date;
    }

    public ExtToHandler(TorrentConfig torrentConfig, TorrentConfig.WebConfig config, HttpClientProvider httpClientProvider) {
        super(torrentConfig, config, httpClientProvider);
    }

    @Override
    public TorrentInfo queryDetail(String id) {
        String requestUrl = String.format("%s/%s/", baseUrl, id);
        HttpRequest request = requestBuilder(requestUrl)
                .GET().build();
        String response = sendPlainTextRequest(request);
        Document document = Jsoup.parse(response);

        Element titleElement = document.selectFirst("h1.card-title");
        String name = titleElement != null ? titleElement.html().trim() : "";

        Element sizeElement = document.selectFirst("span.content-size");
        String sizeStr = sizeElement != null ? sizeElement.text().replace("Size:", "").trim() : null;

        Element posterInfoElement = document.selectFirst("div.detail-torrent-poster-info");
        String uploadTimeText = posterInfoElement != null ? posterInfoElement.text() : null;
        Date uploadTime = parseTime(uploadTimeText);

        List<TorrentFileInfo> files = parseFiles(document);

        String pageToken = Patterns.extractFirstCapturedGroupContent(response, PAGE_TOKEN_PATTERN);
        String csrfToken = Patterns.extractFirstCapturedGroupContent(response, CSRF_TOKEN_PATTERN);

        Element downloadBtn = document.selectFirst("a.download-btn-magnet");
        String torrentId = downloadBtn != null ? downloadBtn.attr("data-id") : extractTorrentId(id);

        long timestamp = System.currentTimeMillis() / 1000;
        String hmac = computeHMAC(torrentId, timestamp, pageToken);
        HttpRequest fetchHashRequest = requestBuilder(String.format("%s/ajax/getTorrentMagnet.php", baseUrl))
                .header("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
                .POST(HttpRequest.BodyPublishers.ofString(String.format("torrent_id=%s&action=get_magnet&timestamp=%s&hmac=%s&sessid=%s", torrentId, timestamp, hmac, csrfToken))).build();
        JsonNode jsonNode = sendJsonRequest(fetchHashRequest);
        if (!jsonNode.path("success").asBoolean(false)) {
            throw new ApiException(ApiError.TORRENT_HASH_NOT_FOUND);
        }

        TorrentInfo torrentInfo = new TorrentInfo();
        torrentInfo.setId(id);
        torrentInfo.setName(name);
        torrentInfo.setSize(UnitUtils.convertSizeUnit(sizeStr));
        torrentInfo.setUploadTime(uploadTime);
        torrentInfo.setFileCount((long) files.size());
        torrentInfo.setFiles(files);

        torrentInfo.setHash(Patterns.extractFirstCapturedGroupContent(jsonNode.path("magnet").asText(""), Patterns.MAGNET_HASH_PATTERN).toUpperCase());

        return torrentInfo;
    }

    private List<TorrentFileInfo> parseFiles(Document document) {
        List<TorrentFileInfo> files = new ArrayList<>();
        Element filesContainer = document.selectFirst("div#torrent_files");
        if (filesContainer == null) {
            return files;
        }

        // Get the main table only (not nested tables)
        Element mainTable = filesContainer.selectFirst("table");
        if (mainTable == null) {
            return files;
        }

        parseTableRows(mainTable, files);
        return files;
    }

    private void parseTableRows(Element table, List<TorrentFileInfo> files) {
        Elements rows = table.select("> tbody > tr");
        for (Element row : rows) {
            Element nestedTable = row.selectFirst("table");
            if (nestedTable != null) {
                parseTableRows(nestedTable, files);
                continue;
            }

            // Extract file link and size
            Element fileLink = row.selectFirst("td.file-name-line-td a");
            if (fileLink == null) {
                continue;
            }

            Elements sizeElements = row.select("td.file-size-td div.file-size");
            TorrentFileInfo fileInfo = new TorrentFileInfo();
            fileInfo.setName(fileLink.text());

            // Second size element contains the file size
            if (sizeElements.size() >= 2) {
                String fileSizeStr = sizeElements.get(1).text().trim();
                fileInfo.setSize(UnitUtils.convertSizeUnit(fileSizeStr, 0L));
            } else {
                fileInfo.setSize(0L);
            }
            files.add(fileInfo);
        }
    }

    public static String extractTorrentId(String fullId) {
        if (fullId == null || fullId.isBlank()) {
            return null;
        }
        int lastDashIndex = fullId.lastIndexOf("-");
        if (lastDashIndex == -1 || lastDashIndex == fullId.length() - 1) {
            return null;
        }
        return fullId.substring(lastDashIndex + 1).trim();
    }

    @Override
    public ScrollPageResult<TorrentInfo> search(String keyword, Long index, String sortField, String sortOrder) {
        String requestUrl = String.format("%s/browse/", baseUrl);
        Map<String, String> param = new HashMap<>(8);
        param.put("page", String.valueOf(index));
        param.put("page_size", String.valueOf(DEFAULT_PAGE_SIZE));
        param.put("q", keyword);
        param.put("with_adult", "1");
        HttpRequest request = requestBuilder(NetUtils.buildParamUrl(requestUrl, param))
                .GET().build();
        String response = sendPlainTextRequest(request);

        Document document = Jsoup.parse(response);
        Element table = document.selectFirst("table.search-table");

        if (table == null) {
            return new ScrollPageResult<>(index, false, new ArrayList<>());
        }
        List<TorrentInfo> torrentInfos = new ArrayList<>(DEFAULT_PAGE_SIZE);
        Elements trs = table.select("tbody tr");

        for (Element tr : trs) {
            // 从第一列提取id和name
            Element titleLink = tr.selectFirst("a.torrent-title-link");
            String id = "";
            String name = "";

            if (titleLink != null) {
                String href = titleLink.attr("href");
                id = href.substring(1, href.length() - 1);
                Element b = titleLink.selectFirst("b");
                if (b != null) {
                    name = b.html().replace("<span>", "").replace("</span>", "").trim();
                }
            }

            // 从其他列提取size和age
            String sizeStr = null;
            String ageStr = null;

            Elements sizeWrappers = tr.select("span.add-block");
            for (Element wrapper : sizeWrappers) {
                String label = wrapper.text().trim();
                Element valueSpan = wrapper.nextElementSibling();
                if (valueSpan != null) {
                    if ("Size".equals(label)) {
                        sizeStr = valueSpan.text().trim();
                    } else if ("Age".equals(label)) {
                        ageStr = valueSpan.text().trim();
                    }
                }
            }

            TorrentInfo torrentInfo = new TorrentInfo();
            torrentInfo.setId(id);
            torrentInfo.setName(name);
            torrentInfo.setSize(UnitUtils.convertSizeUnit(sizeStr, 0L));
            torrentInfo.setUploadTime(parseTime(ageStr));
            // 列表页无法获取Hash
            torrentInfo.setHash(null);
            torrentInfos.add(torrentInfo);
        }
        Elements pageLis = document.select("ul.pages li");
        boolean hasMore = !pageLis.isEmpty() && !pageLis.get(pageLis.size() - 1).classNames().contains("active");
        return new ScrollPageResult<>(index, hasMore, torrentInfos);
    }

    @Override
    public String url() {
        return "https://ext.to";
    }

    @Override
    public List<String> sortFields() {
        return List.of();
    }

    @Override
    public String code() {
        return "extTo";
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
