package cn.gloduck.api.service.torrent.handler;

import cn.gloduck.api.entity.config.TorrentConfig;
import cn.gloduck.api.entity.model.torrent.TorrentInfo;
import cn.gloduck.api.exceptions.ApiError;
import cn.gloduck.api.exceptions.ApiException;
import cn.gloduck.api.service.http.HttpClientProvider;
import cn.gloduck.api.utils.*;
import cn.gloduck.common.entity.base.ScrollPageResult;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;

import java.net.URLEncoder;
import java.net.http.HttpRequest;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class TokyoToshokanHandler extends AbstractTorrentHandler {
    private static final Pattern CUR_PAGE_INFO_NUMBER_PATTERN = Pattern.compile("Showing results (\\d+) to (\\d+) of (\\d+)");
    private static final Pattern CUR_PAGE_INFO_PATTERN = Pattern.compile("Showing results \\d+ to \\d+ of \\d+");

    public TokyoToshokanHandler(TorrentConfig torrentConfig, TorrentConfig.WebConfig config, HttpClientProvider httpClientProvider) {
        super(torrentConfig, config, httpClientProvider);
    }

    @Override
    public TorrentInfo queryDetail(String id) {
        String requestUrl = String.format("%s/details.php?id=%s", baseUrl, id);
        HttpRequest request = requestBuilder(requestUrl)
                .GET()
                .build();
        String response = sendPlainTextRequest(request);
        if (response.contains("Entry not found")) {
            return null;
        }
        Document doc = Jsoup.parse(response);

        String name = null;
        String uploadTimeStr = null;
        String fileSizeStr = null;
        String hash = null;

        Elements lis = doc.select("div.details > ul > li");
        for (int i = 0; i < lis.size(); i += 2) {
            Element labelLi = lis.get(i);
            Element valueLi = lis.get(i + 1);
            String label = labelLi.text().trim();

            if (label.startsWith("Torrent Name:")) {
                Element a = valueLi.selectFirst("a[type=\"application/x-bittorrent\"]");
                if (a != null) {
                    name = a.html().replace("<span class=\"s\"> </span>", "").trim();
                }
            } else if (label.startsWith("Date Submitted:")) {
                uploadTimeStr = valueLi.text().trim();
            } else if (label.startsWith("Filesize:")) {
                fileSizeStr = valueLi.text().trim();
            } else if (label.startsWith("BT Info Hash")) {
                Element a = valueLi.selectFirst("a[href^=magnet:]");
                if (a != null) {
                    hash = Patterns.extractFirstCapturedGroupContent(a.attr("href"), Patterns.MAGNET_HASH_PATTERN);
                }
            }
        }

        if (hash == null) {
            throw new ApiException(ApiError.TORRENT_HASH_NOT_FOUND);
        }
        TorrentInfo torrentInfo = new TorrentInfo();
        torrentInfo.setId(id);
        torrentInfo.setName(name);
        torrentInfo.setHash(hash.toUpperCase());
        torrentInfo.setSize(UnitUtils.convertSizeUnit(fileSizeStr, 0L));
        torrentInfo.setUploadTime(DateUtils.convertTimeStringToDate(uploadTimeStr, DateUtils.DASH_SEPARATED_DATE_TIME_FORMAT_PADDED_ZONE));
        torrentInfo.setFileCount(null);
        torrentInfo.setFiles(null);

        return torrentInfo;
    }

    @Override
    public ScrollPageResult<TorrentInfo> search(String keyword, Long index, String sortField, String sortOrder) {
        Map<String, String> param = new HashMap<>();
        param.put("page", String.valueOf(index));
        param.put("searchComment", "true");
        param.put("searchName", "true");
        param.put("terms", keyword);
        String requestUrl = NetUtils.buildParamUrl(String.format("%s/search.php", baseUrl), param);
        HttpRequest request = requestBuilder(requestUrl)
                .GET()
                .build();
        String response = sendPlainTextRequest(request);
        if (response.contains("No results returned")) {
            return new ScrollPageResult<>(index, false, new ArrayList<>());
        }
        Document document = Jsoup.parse(response);
        Elements trs = document.select("table.listing tbody tr.category_0");
        if (trs.size() % 2 != 0) {
            throw new ApiException(ApiError.TORRENT_RESPONSE_INVALID);
        }
        ArrayList<TorrentInfo> torrentInfos = new ArrayList<>(pageSize());
        for (int i = 0; i < trs.size(); i += 2) {
            Element mainRow = trs.get(i);
            Element infoRow = trs.get(i + 1);

            // 从主行提取id、name、hash
            Element titleLink = mainRow.selectFirst("a[href^=magnet:]");
            Element detailLink = mainRow.selectFirst("a[href^=details.php?id=]");
            Element torrentLink = mainRow.selectFirst("a[type=\"application/x-bittorrent\"]");

            String id = null;
            String name = null;
            String hash = null;

            if (detailLink != null) {
                String href = detailLink.attr("href");
                id = href.replace("details.php?id=", "").trim();
            }

            if (torrentLink != null) {
                name = torrentLink.html().replace("<span class=\"s\"> </span>", "").trim();
            }

            if (titleLink != null) {
                String magnetHref = titleLink.attr("href");
                hash = Patterns.extractFirstCapturedGroupContent(magnetHref, Patterns.MAGNET_HASH_PATTERN);
                if (hash != null) {
                    hash = hash.toUpperCase();
                }
            }

            String descBotText = Optional.ofNullable(infoRow.selectFirst("td.desc-bot")).map(Element::text).orElse("");
            String sizeStr = findFieldFromJoinString(descBotText, "Size");
            String uploadTimeStr = findFieldFromJoinString(descBotText, "Date");

            TorrentInfo torrentInfo = new TorrentInfo();
            torrentInfo.setId(id);
            torrentInfo.setName(name);
            torrentInfo.setHash(hash);
            torrentInfo.setSize(UnitUtils.convertSizeUnit(sizeStr, 0L));
            torrentInfo.setUploadTime(DateUtils.convertTimeStringToDate(uploadTimeStr, DateUtils.DASH_SEPARATED_DATE_TIME_FORMAT_PADDED_ZONE));
            torrentInfos.add(torrentInfo);
        }

        boolean hasNext = !isLastPage(response);
        // 第一页只有49条数据，补充一条虚拟数据，防止分页错误
        if (index == 1 && hasNext && torrentInfos.size() < pageSize()) {
            int leftSize = pageSize() - torrentInfos.size();
            for (int i = 0; i < leftSize; i++) {
                torrentInfos.add(torrentInfos.get(0));
            }
        }
        return new ScrollPageResult<>(index, hasNext, torrentInfos);
    }

    private String findFieldFromJoinString(String joinString, String fieldName) {
        String result = StringUtils.subBetween(joinString, fieldName + ": ", " |");
        if (result == null) {
            result = joinString.substring(joinString.indexOf(fieldName + ": ") + (fieldName + ": ").length());
        }
        if (StringUtils.isNullOrEmpty(result)) {
            return null;
        }
        return result.trim();
    }

    @Override
    public List<String> sortFields() {
        return Collections.emptyList();
    }

    @Override
    public String code() {
        return "TokyoToshokan";
    }

    @Override
    public List<String> tags() {
        return Arrays.asList("ACG", "JAV");
    }

    @Override
    public int pageSize() {
        return 50;
    }


    public static boolean isLastPage(String htmlContent) {
        if (htmlContent == null || htmlContent.isEmpty()) {
            return true;
        }
        Matcher matcher = CUR_PAGE_INFO_PATTERN.matcher(htmlContent);

        if (!matcher.find()) {
            return true;
        }
        String curPageInfo = matcher.group();

        Matcher numberMatcher = CUR_PAGE_INFO_NUMBER_PATTERN.matcher(curPageInfo);
        if (numberMatcher.matches()) {
            try {
                int endOfRange = Integer.parseInt(numberMatcher.group(2));
                int totalCount = Integer.parseInt(numberMatcher.group(3));
                return endOfRange >= totalCount;
            } catch (NumberFormatException e) {
                return true;
            }
        } else {
            return true;
        }
    }
}
