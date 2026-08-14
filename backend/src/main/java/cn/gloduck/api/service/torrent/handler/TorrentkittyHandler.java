package cn.gloduck.api.service.torrent.handler;

import cn.gloduck.api.entity.config.TorrentConfig;
import cn.gloduck.api.entity.model.torrent.TorrentFileInfo;
import cn.gloduck.api.entity.model.torrent.TorrentInfo;
import cn.gloduck.api.service.http.HttpClientProvider;
import cn.gloduck.api.utils.DateUtils;
import cn.gloduck.api.utils.StringUtils;
import cn.gloduck.api.utils.UnitUtils;
import cn.gloduck.common.entity.base.ScrollPageResult;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;

import java.net.URLEncoder;
import java.net.http.HttpRequest;
import java.nio.charset.StandardCharsets;
import java.util.*;

public class TorrentkittyHandler extends AbstractTorrentHandler {

    public TorrentkittyHandler(TorrentConfig torrentConfig, TorrentConfig.WebConfig config, HttpClientProvider httpClientProvider) {
        super(torrentConfig, config, httpClientProvider);
    }

    @Override
    public TorrentInfo queryDetail(String id) {
        String requestUrl = String.format("%s/information/%s", baseUrl, id);
        HttpRequest request = requestBuilder(requestUrl)
                .GET()
                .build();
        String response = sendPlainTextRequest(request);
        Document document = Jsoup.parse(response);
        String name = Optional.of(document.getElementsByTag("h2")).map(t -> t.isEmpty() ? null : t.get(0).text().trim()).orElse("");
        TorrentInfo torrentInfo = new TorrentInfo();
        torrentInfo.setId(id);
        torrentInfo.setName(name);
        Element detailTable = document.selectFirst("table.detailSummary");
        Elements trs = detailTable.getElementsByTag("tr");
        for (Element tr : trs) {
            String trContent = Optional.of(tr.getElementsByTag("th")).map(t -> t.isEmpty() ? null : t.get(0).text().trim()).orElse("");
            String tdContent = Optional.of(tr.getElementsByTag("td")).map(t -> t.isEmpty() ? null : t.get(0).text().trim()).orElse("");
            if (trContent.contains("Torrent Hash:")) {
                torrentInfo.setHash(tdContent);
            }
            if (trContent.contains("Number of Files:")) {
                torrentInfo.setFileCount(Long.parseLong(tdContent));
            }
            if (trContent.contains("Content Size:")) {
                torrentInfo.setSize(UnitUtils.convertSizeUnit(tdContent));
            }
            if (trContent.contains("Created On:")) {
                torrentInfo.setUploadTime(parseDateStr(tdContent));
            }
        }

        List<TorrentFileInfo> files = parseFileList(document);


        torrentInfo.setFiles(files);

        return torrentInfo;
    }

    private Date parseDateStr(String dateStr) {
        if (dateStr == null) {
            return null;
        }
        dateStr += " 00:00:00";
        return DateUtils.convertTimeStringToDate(dateStr, DateUtils.DASH_SEPARATED_DATE_TIME_FORMAT);
    }

    private List<TorrentFileInfo> parseFileList(Document document) {
        Element tableElement = document.selectFirst("table#torrentDetail");
        if (tableElement == null) {
            return Collections.emptyList();
        }

        List<TorrentFileInfo> fileList = new ArrayList<>();
        Elements rows = tableElement.select("tr");
        for (Element row : rows) {
            String fileName = Optional.ofNullable(row.selectFirst("td.name")).map(t -> t.text().trim()).orElse(null);
            String fileSizeStr = Optional.ofNullable(row.selectFirst("td.size")).map(t -> t.text().trim()).orElse(null);
            if(fileName == null && fileSizeStr == null){
                continue;
            }
            TorrentFileInfo fileInfo = new TorrentFileInfo();
            fileInfo.setName(fileName);
            fileInfo.setSize(UnitUtils.convertSizeUnit(fileSizeStr, 0L));
            fileList.add(fileInfo);
        }
        return fileList;
    }

    @Override
    public ScrollPageResult<TorrentInfo> search(String keyword, Long index, String sortField, String sortOrder) {
        String requestUrl = String.format("%s/search/%s/%d", baseUrl, URLEncoder.encode(keyword, StandardCharsets.UTF_8), index);
        HttpRequest request = requestBuilder(requestUrl)
                .GET()
                .build();
        String response = sendPlainTextRequest(request);

        if (response.contains("No result")) {
            return new ScrollPageResult<>(index, false, new ArrayList<>());
        }

        Document document = Jsoup.parse(response);
        Element tableElement = document.selectFirst("table#archiveResult");
        if (tableElement == null) {
            return new ScrollPageResult<>(index, false, new ArrayList<>());
        }

        List<TorrentInfo> torrentInfos = new ArrayList<>(pageSize());
        Elements rows = tableElement.select("tr");
        for (Element row : rows) {
            Elements tds = row.getElementsByTag("td");
            if (tds.size() < 4) {
                continue;
            }

            String name = tds.get(0).text().trim();
            String size = tds.get(1).text().trim();
            String date = tds.get(2).text().trim();
            String action = tds.get(3).html();

            String hash = StringUtils.subBetween(action, "/information/", "\"");
            if (hash == null) {
                continue;
            }

            if (name.isEmpty()) {
                name = hash;
            }

            TorrentInfo torrentInfo = new TorrentInfo();
            torrentInfo.setId(hash);
            torrentInfo.setName(name);
            torrentInfo.setHash(hash.toUpperCase());
            torrentInfo.setSize(UnitUtils.convertSizeUnit(size, 0L));
            torrentInfo.setUploadTime(parseDateStr(date));
            torrentInfos.add(torrentInfo);
        }

        // 判断是否有下一页
        boolean isEnd = !hasNextPage(document);
        return new ScrollPageResult<>(index, !isEnd, torrentInfos);
    }


    private boolean hasNextPage(Document document) {
        Element pagination = document.selectFirst("div.pagination");
        if (pagination == null) {
            return false;
        }
        String html = pagination.html();
        if (html.isEmpty()) {
            return false;
        }
        return !html.contains("<span class=\"disabled\">»</span>");
    }

    @Override
    public List<String> sortFields() {
        return Collections.emptyList();
    }

    @Override
    public int pageSize() {
        return 20;
    }

    @Override
    public String code() {
        return "torrentkitty";
    }

    @Override
    public List<String> tags() {
        return Arrays.asList("ALL");
    }
}
