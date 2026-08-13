package cn.gloduck.api.service.torrent.handler;

import cn.gloduck.api.entity.config.TorrentConfig;
import cn.gloduck.api.entity.model.torrent.TorrentFileInfo;
import cn.gloduck.api.entity.model.torrent.TorrentInfo;
import cn.gloduck.api.exceptions.ApiError;
import cn.gloduck.api.exceptions.ApiException;
import cn.gloduck.api.utils.NetUtils;
import cn.gloduck.api.utils.Patterns;
import cn.gloduck.api.utils.StringUtils;
import cn.gloduck.api.utils.UnitUtils;
import cn.gloduck.common.entity.base.ScrollPageResult;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Attribute;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;

import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class BtDiggHandler extends AbstractTorrentHandler {
    private static final Pattern TIME_PATTERN = Pattern.compile(".*?(\\d+)\\s+(second|minute|hour|day|month|year)s?.*", Pattern.CASE_INSENSITIVE);

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

    public BtDiggHandler(TorrentConfig torrentConfig, TorrentConfig.WebConfig config) {
        super(torrentConfig, config);
    }

    public String sendPlainTextGetRequest(String requestUrl, int depth) {
        String body = null;
        try {
            HttpResponse<String> response = httpClient.send(requestBuilder(requestUrl).GET().build(), new StringBodyHandler());
            if (response.statusCode() == 200) {
                body = response.body();
            } else if (response.statusCode() == 302 || response.statusCode() == 301) {
                String location = response.headers().firstValue("location").orElse(null);
                if (location == null) {
                    throw new RuntimeException("Error redirect, location header is null");
                }

                if (depth < 3) {
                    body = sendPlainTextGetRequest(location, depth + 1);
                } else {
                    throw new RuntimeException(String.format("Too many redirects (depth: %d), status code: %d, location: %s", depth, response.statusCode(), location));
                }
            } else {
                throw new RuntimeException(String.format("Server response error code: %s, response: %s", response.statusCode(), response.body()));
            }
            return body;
        } catch (Exception e) {
            LOGGER.warning(String.format("Request [%s] Error: %s, response: %s", requestUrl, e.getMessage(), body));
            throw new ApiException(ApiError.TORRENT_REQUEST_FAILED, e);
        }
    }

    @Override
    public TorrentInfo queryDetail(String id) {
        String requestUrl = String.format("%s/%s", baseUrl, id);
        HttpRequest request = requestBuilder(requestUrl)
                .GET().build();
        String response = sendPlainTextRequest(request);
        Document document = Jsoup.parse(response);
        Elements tables = document.getElementsByTag("table");
        Element torrentInfoTable = tables.stream().filter(t -> t.html().contains("fa fa-magnet")).findAny().orElse(null);
        if (torrentInfoTable == null) {
            throw new ApiException(ApiError.TORRENT_INFO_NOT_FOUND);
        }
        Elements infos = torrentInfoTable.select("table tr");
        TorrentInfo torrentInfo = new TorrentInfo();
        torrentInfo.setId(id);
        boolean nextIsFiles = false;
        for (Element info : infos) {
            Elements tds = info.getElementsByTag("td");
            if (tds.size() == 2) {
                if (Objects.equals(tds.get(0).text().trim(), "Download:")) {
                    String href = Optional.ofNullable(tds.get(1).selectFirst("a")).map(t -> t.attribute("href")).map(Attribute::getValue).orElse(null);
                    if (href == null) {
                        throw new ApiException(ApiError.TORRENT_HASH_NOT_FOUND);
                    }
                    torrentInfo.setHash(Patterns.extractFirstCapturedGroupContent(href, Patterns.MAGNET_HASH_PATTERN));
                } else if (Objects.equals(tds.get(0).text().trim(), "Name:")) {
                    torrentInfo.setName(tds.get(1).text().trim());
                } else if (Objects.equals(tds.get(0).text().trim(), "Size:")) {
                    torrentInfo.setSize(UnitUtils.convertSizeUnit(tds.get(1).text().trim(), 0L));
                } else if (Objects.equals(tds.get(0).text().trim(), "Age:")) {
                    torrentInfo.setUploadTime(parseTime(tds.get(1).text().trim()));
                } else if (Objects.equals(tds.get(0).text().trim(), "Files:")) {
                    String fileCountStr = tds.get(1).text().trim();
                    if (StringUtils.isNotNullOrEmpty(fileCountStr)) {
                        torrentInfo.setFileCount(Long.parseLong(fileCountStr));
                    }
                }
            }
            if (nextIsFiles && !tds.isEmpty()) {
                Elements fileDivs = tds.get(0).select("div[class*=fa-file-]");
                List<TorrentFileInfo> fileList = new ArrayList<>(fileDivs.size());
                for (Element div : fileDivs) {
                    // 文件名
                    String fileName = div.ownText().trim();

                    // 文件大小：取当前 div 后面**第一个** span
                    Element sizeSpan = div.nextElementSibling();
                    String fileSizeStr = null;
                    if (sizeSpan != null && "span".equals(sizeSpan.tagName())) {
                        fileSizeStr = sizeSpan.text().trim();
                    }
                    long fileSize = UnitUtils.convertSizeUnit(fileSizeStr, 0L);
                    TorrentFileInfo fileInfo = new TorrentFileInfo();
                    fileInfo.setName(fileName);
                    fileInfo.setSize(fileSize);
                    fileList.add(fileInfo);
                }
                torrentInfo.setFiles(fileList);
                nextIsFiles = false;
            }
            Elements ths = info.getElementsByTag("th");
            for (Element th : ths) {
                if (Objects.equals(th.text().trim(), "Files")) {
                    nextIsFiles = true;
                    break;
                }
            }

        }
        return torrentInfo;
    }

    @Override
    public ScrollPageResult<TorrentInfo> search(String keyword, Long index, String sortField, String sortOrder) {
        String requestUrl = String.format("%s/search", baseUrl);
        Map<String, String> param = new HashMap<>(8);
        param.put("p", String.valueOf(index));
        param.put("q", keyword);
        if (sortField != null) {
            param.put("order", convertSortField(sortField));
        }
        String response = sendPlainTextGetRequest(NetUtils.buildParamUrl(requestUrl, param), 0);
        if (response.contains("0 results found")) {
            return new ScrollPageResult<>(index, false, new ArrayList<>());
        }
        Document document = Jsoup.parse(response);
        Elements results = document.getElementsByClass("one_result");
        List<TorrentInfo> torrentInfos = new ArrayList<>(results.size());
        for (Element result : results) {
            String name = Optional.ofNullable(result.selectFirst(".torrent_name a")).map(Element::text).orElse(null);
            String sizeStr = Optional.ofNullable(result.selectFirst(".torrent_size")).map(Element::text).orElse(null);
            long size = UnitUtils.convertSizeUnit(sizeStr, 0L);
            String magnet = Optional.ofNullable(result.selectFirst(".torrent_magnet a")).map(t -> t.attribute("href")).map(Attribute::getValue).orElse(null);
            String hash = magnet != null ? Patterns.extractFirstCapturedGroupContent(magnet, Patterns.MAGNET_HASH_PATTERN) : null;
            if (hash == null) {
                continue;
            }
            String age = Optional.ofNullable(result.selectFirst(".torrent_age")).map(Element::text).orElse(null);
            TorrentInfo info = new TorrentInfo();
            info.setId(hash);
            info.setName(name);
            info.setHash(hash.toUpperCase());
            info.setSize(size);
            info.setUploadTime(parseTime(age));
            info.setFileCount(null);
            info.setFiles(null);
            torrentInfos.add(info);
        }
        boolean hasNext = response.contains("Next →");

        return new ScrollPageResult<>(index, hasNext, torrentInfos);
    }

    private String convertSortField(String sortFiled) {
        return switch (sortFiled) {
            case "relevance" -> "0";
            case "fileCount" -> "4";
            case "uploadTime" -> "2";
            case "size" -> "3";
            default -> throw new ApiException(ApiError.INVALID_PARAMETER);
        };
    }

    @Override
    public List<String> sortFields() {
        return Arrays.asList("-relevance", "-fileCount", "-uploadTime", "-size");
    }

    @Override
    public String code() {
        return "btDigg";
    }

    @Override
    public List<String> tags() {
        return Arrays.asList("ALL");
    }

    @Override
    public int pageSize() {
        return 10;
    }
}
