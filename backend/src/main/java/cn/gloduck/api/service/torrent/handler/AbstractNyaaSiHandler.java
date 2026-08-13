package cn.gloduck.api.service.torrent.handler;

import cn.gloduck.api.entity.config.TorrentConfig;
import cn.gloduck.api.entity.model.torrent.TorrentFileInfo;
import cn.gloduck.api.entity.model.torrent.TorrentInfo;
import cn.gloduck.api.exceptions.ApiError;
import cn.gloduck.api.exceptions.ApiException;
import cn.gloduck.api.utils.DateUtils;
import cn.gloduck.api.utils.NetUtils;
import cn.gloduck.api.utils.Patterns;
import cn.gloduck.api.utils.UnitUtils;
import cn.gloduck.common.entity.base.ScrollPageResult;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;

import java.net.http.HttpRequest;
import java.util.*;

public abstract class AbstractNyaaSiHandler extends AbstractTorrentHandler {
    public AbstractNyaaSiHandler(TorrentConfig torrentConfig, TorrentConfig.WebConfig config) {
        super(torrentConfig, config);
    }

    @Override
    public TorrentInfo queryDetail(String id) {
        String requestUrl = String.format("%s/view/%s", baseUrl, id);
        HttpRequest request = requestBuilder(requestUrl)
                .GET()
                .build();
        String response = sendPlainTextRequest(request);
        if (response.contains("404 Not Found")) {
            return null;
        }
        Document doc = Jsoup.parse(response);
        String hash = Optional.ofNullable(doc.selectFirst("kbd")).map(Element::text).orElse(null);
        if (hash == null) {
            throw new ApiException(ApiError.TORRENT_HASH_NOT_FOUND);
        }
        String name = Optional.ofNullable(doc.selectFirst("div.panel-heading h3.panel-title")).map(Element::text).orElse(null);
        String fileSizeStr = null;
        long timestamp = 0;
        Elements infos = doc.select("div.panel-body div.row");
        for (Element info : infos) {
            Elements labels = info.select("div.col-md-1");
            Elements values = info.select("div.col-md-5");
            for (int i = 0; i < labels.size() && i < values.size(); i++) {
                String labelText = labels.get(i).text().trim();
                Element value = values.get(i);
                if ("File size:".equals(labelText)) {
                    fileSizeStr = value.text().trim();
                } else if ("Date:".equals(labelText)) {
                    String ts = value.attr("data-timestamp");
                    if (!ts.isEmpty()) {
                        timestamp = Long.parseLong(ts);
                    }
                }
            }
        }

        List<TorrentFileInfo> torrentFileInfos = parseFileInfo(doc);

        TorrentInfo torrentInfo = new TorrentInfo();
        torrentInfo.setId(id);
        torrentInfo.setName(name);
        torrentInfo.setHash(hash);
        torrentInfo.setSize(UnitUtils.convertSizeUnit(fileSizeStr, 0L));
        torrentInfo.setUploadTime(timestamp > 0 ? new Date(timestamp * 1000) : null);
        torrentInfo.setFileCount((long) torrentFileInfos.size());
        torrentInfo.setFiles(torrentFileInfos);

        return torrentInfo;
    }

    private List<TorrentFileInfo> parseFileInfo(Document doc) {
        List<TorrentFileInfo> fileList = new ArrayList<>();
        Elements lis = doc.select("div.torrent-file-list li:has(> i.fa-file)");
        for (Element li : lis) {
            String fileName = Optional.ofNullable(li.selectFirst("i.fa-file"))
                    .map(t -> t.nextSibling())
                    .map(t -> t.toString())
                    .map(t -> t.trim())
                    .orElse("");
            String fileSizeStr = java.util.Optional.ofNullable(li.selectFirst("span.file-size"))
                    .map(Element::text)
                    .orElse("");
            fileSizeStr = fileSizeStr.replace("(", "").replace(")", "").trim();

            TorrentFileInfo fileInfo = new TorrentFileInfo();
            fileInfo.setName(fileName);
            fileInfo.setSize(UnitUtils.convertSizeUnit(fileSizeStr, 0L));
            fileList.add(fileInfo);
        }
        return fileList;
    }

    @Override
    public ScrollPageResult<TorrentInfo> search(String keyword, Long index, String sortField, String sortOrder) {
        sortField = convertSortFiled(sortField);
        Map<String, String> param = new HashMap<>(8);
        param.put("q", keyword);
        param.put("p", String.valueOf(index));
        param.put("c", "0_0");
        if (sortField != null) {
            param.put("s", sortField);
            param.put("o", sortOrder);
        }
        String url = String.format("%s/", baseUrl);
        HttpRequest request = requestBuilder(NetUtils.buildParamUrl(url, param))
                .GET()
                .build();
        String response = sendPlainTextRequest(request);
        if (response.contains("No results found")) {
            return new ScrollPageResult<>(index, false, new ArrayList<>());
        }
        Document document = Jsoup.parse(response);
        Elements trs = document.select("tbody tr.default");
        ArrayList<TorrentInfo> torrentInfos = new ArrayList<>(pageSize());
        for (Element tr : trs) {
            Elements tds = tr.getElementsByTag("td");
            if (tds.size() != 8) {
                continue;
            }
            Element titleLink = tds.get(1).selectFirst("a[href^=/view/]");
            String id = null;
            String name = null;
            if (titleLink != null) {
                String href = titleLink.attr("href");
                id = href.replace("/view/", "").trim();
                name = titleLink.attr("title").trim();
            }
            if (id == null) {
                continue;
            }

            String hash = null;
            Element magnetLink = tds.get(2).selectFirst("a[href^=magnet:]");
            if (magnetLink != null) {
                String magnetHref = magnetLink.attr("href");
                hash = Patterns.extractFirstCapturedGroupContent(magnetHref, Patterns.MAGNET_HASH_PATTERN).toUpperCase();
            }

            String sizeStr = tds.get(3).text().trim();
            String uploadTimeStr = tds.get(4).text().trim();

            TorrentInfo torrentInfo = new TorrentInfo();
            torrentInfo.setId(id);
            torrentInfo.setName(name);
            torrentInfo.setHash(hash);
            torrentInfo.setSize(UnitUtils.convertSizeUnit(sizeStr, 0L));
            torrentInfo.setUploadTime(DateUtils.convertTimeStringToDate(uploadTimeStr, DateUtils.DASH_SEPARATED_DATE_TIME_FORMAT_PADDED));
            torrentInfos.add(torrentInfo);
        }
        boolean hasNext = document.selectFirst("li.next") != null;
        return new ScrollPageResult<>(index, hasNext, torrentInfos);
    }

    private String convertSortFiled(String sortField) {
        if (sortField == null) {
            return null;
        }
        return switch (sortField) {
            case "size" -> "size";
            case "uploadTime" -> "id";
            default -> null;
        };
    }

    @Override
    public List<String> sortFields() {
        return Arrays.asList("uploadTime", "size");
    }


    @Override
    public int pageSize() {
        return 75;
    }

}
