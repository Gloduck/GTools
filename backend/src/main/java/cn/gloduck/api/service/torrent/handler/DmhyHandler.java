package cn.gloduck.api.service.torrent.handler;

import cn.gloduck.api.entity.config.TorrentConfig;
import cn.gloduck.api.entity.model.torrent.TorrentFileInfo;
import cn.gloduck.api.entity.model.torrent.TorrentInfo;
import cn.gloduck.api.exceptions.ApiError;
import cn.gloduck.api.exceptions.ApiException;
import cn.gloduck.api.service.http.HttpClientProvider;
import cn.gloduck.api.utils.DateUtils;
import cn.gloduck.api.utils.Patterns;
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

public class DmhyHandler extends AbstractTorrentHandler {


    public DmhyHandler(TorrentConfig torrentConfig, TorrentConfig.WebConfig config, HttpClientProvider httpClientProvider) {
        super(torrentConfig, config, httpClientProvider);
    }

    @Override
    public TorrentInfo queryDetail(String id) {
        String requestUrl = String.format("%s/topics/view/%s.html", baseUrl, id);
        HttpRequest request = requestBuilder(requestUrl)
                .GET()
                .build();
        String response = sendPlainTextRequest(request);
        Document doc = Jsoup.parse(response);

        String name = Optional.ofNullable(doc.selectFirst("title"))
                .map(t -> t.text().replace(" - 動漫花園資源網 - 動漫愛好者的自由交流平台", ""))
                .orElse("");

        Date uploadTime = null;
        long size = 0L;
        Elements infoLis = doc.select(".resource-info ul li");
        for (Element infoLi : infoLis) {
            if(infoLi.text().contains("發佈時間")){
                String uploadTimeStr = Optional.ofNullable(infoLi.selectFirst("span")).map(Element::text).orElse(null);
                uploadTime = DateUtils.convertTimeStringToDate(uploadTimeStr, DateUtils.SLASH_SEPARATED_DATE_TIME_FORMAT_NO_PAD);
            } else if(infoLi.text().contains("文件大小")){
                String span = Optional.ofNullable(infoLi.selectFirst("span")).map(Element::text).orElse(null);
                size = UnitUtils.convertSizeUnit(span, 0L);
            }
        }
        String hash = null;
        Element magnetLink = doc.selectFirst("a[href^=magnet:]");
        if (magnetLink != null) {
            String magnetHref = magnetLink.attr("href");
            hash = Patterns.extractFirstCapturedGroupContent(magnetHref, Patterns.MAGNET_HASH_PATTERN).toUpperCase();
        }

        TorrentInfo torrentInfo = new TorrentInfo();
        torrentInfo.setId(id);
        torrentInfo.setName(name);
        torrentInfo.setHash(hash);
        torrentInfo.setSize(size);
        torrentInfo.setUploadTime(uploadTime);
        List<TorrentFileInfo> torrentFileInfos = parseFileInfo(doc);
        torrentInfo.setFileCount((long) torrentFileInfos.size());
        torrentInfo.setFiles(torrentFileInfos);

        return torrentInfo;
    }

    private List<TorrentFileInfo> parseFileInfo(Document doc){
        List<TorrentFileInfo> fileList = new ArrayList<>();
        Elements lis = doc.select("div.file_list li");
        for (Element li : lis) {
            Element imgElement = li.selectFirst("img");
            Element fileSizeElement = li.selectFirst("span.bt_file_size");
            String fileName = "";
            if(imgElement != null && fileSizeElement != null){
                fileName = StringUtils.subBetween(li.html(), imgElement.outerHtml(), fileSizeElement.outerHtml());
            }

            String fileSizeStr = Optional.ofNullable(fileSizeElement).map(Element::text).orElse(null);
            Long size = UnitUtils.convertSizeUnit(fileSizeStr, 0L);
            TorrentFileInfo fileInfo = new TorrentFileInfo();
            fileInfo.setName(fileName);
            fileInfo.setSize(size);
            fileList.add(fileInfo);
        }
        return fileList;
    }

    @Override
    public ScrollPageResult<TorrentInfo> search(String keyword, Long index, String sortField, String sortOrder) {
        String requestUrl = String.format("%s/topics/list/page/%s?keyword=%s", baseUrl, index, URLEncoder.encode(keyword, StandardCharsets.UTF_8));
        HttpRequest request = requestBuilder(requestUrl)
                .GET()
                .build();
        String response = sendPlainTextRequest(request);
        if(response.contains("沒有可顯示資源")){
            return new ScrollPageResult<>(index, false, new ArrayList<>());
        }
        Document document = Jsoup.parse(response);
        Element torrentTable = document.selectFirst("#topic_list tbody");

        ArrayList<TorrentInfo> torrentInfos = new ArrayList<>(pageSize());
        if (torrentTable == null) {
            throw new ApiException(ApiError.TORRENT_RESPONSE_INVALID);
        }
        Elements trs = torrentTable.getElementsByTag("tr");
        for (Element tr : trs) {
            Elements tds = tr.getElementsByTag("td");
            if (tds.size() != 9) {
                continue;
            }
            // 日期在隐藏的span中
            String uploadTimeStr = Optional.ofNullable(tds.get(0).selectFirst("span"))
                    .map(Element::text)
                    .orElse(null);
            if (uploadTimeStr == null) {
                uploadTimeStr = tds.get(0).text().trim();
            }

            // 解析标题中的id和名称
            Element titleLink = tds.get(2).selectFirst("a[href^=/topics/view/]");
            String id = null;
            String name = null;
            if (titleLink != null) {
                String href = titleLink.attr("href");
                id = StringUtils.subBetween(href, "/topics/view/", ".html");
                String titleHtml = titleLink.html();
                name = titleHtml.replaceAll("<span class=\"keyword\">", "")
                        .replace("</span>", "")
                        .trim();
            }

            // 从磁力链接提取hash
            Element magnetLink = tds.get(3).selectFirst("a[href^=magnet:]");
            String hash = null;
            if (magnetLink != null) {
                String magnetHref = magnetLink.attr("href");
                hash = Patterns.extractFirstCapturedGroupContent(magnetHref, Patterns.MAGNET_HASH_PATTERN).toUpperCase();
            }

            String sizeStr = tds.get(4).text().trim();

            TorrentInfo torrentInfo = new TorrentInfo();
            torrentInfo.setId(id);
            torrentInfo.setName(name);
            torrentInfo.setHash(hash);
            torrentInfo.setSize(UnitUtils.convertSizeUnit(sizeStr, 0L));
            torrentInfo.setUploadTime(DateUtils.convertTimeStringToDate(uploadTimeStr, DateUtils.SLASH_SEPARATED_DATE_TIME_FORMAT_NO_PAD));
            torrentInfos.add(torrentInfo);
        }
        boolean hasNext = document.selectFirst("a[href*=/topics/list/page/" + (index + 1) + "]") != null;
        return new ScrollPageResult<>(index, hasNext, torrentInfos);
    }



    @Override
    public List<String> sortFields() {
        return Collections.emptyList();
    }

    @Override
    public int pageSize() {
        return 80;
    }

    @Override
    public String code(){
        return "dmhy";
    }

    @Override
    public List<String> tags() {
        return Arrays.asList("ACG");
    }

}
