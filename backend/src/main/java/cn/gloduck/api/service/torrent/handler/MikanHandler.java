package cn.gloduck.api.service.torrent.handler;

import cn.gloduck.api.entity.config.TorrentConfig;
import cn.gloduck.api.entity.model.torrent.TorrentInfo;
import cn.gloduck.api.service.http.HttpClientProvider;
import cn.gloduck.api.utils.DateUtils;
import cn.gloduck.api.utils.Patterns;
import cn.gloduck.api.utils.UnitUtils;
import cn.gloduck.common.entity.base.ScrollPageResult;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpRequest;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

public class MikanHandler extends AbstractTorrentHandler{

    // 匹配十六进制实体：&#x开头， followed by 1-6位十六进制数字，以;结尾
    private static final Pattern HEX_ENTITY_PATTERN = Pattern.compile("&#x([0-9a-fA-F]{1,6});");

    // 匹配十进制实体：&#开头， followed by 1-7位数字，以;结尾
    private static final Pattern DECIMAL_ENTITY_PATTERN = Pattern.compile("&#(\\d{1,7});");

    public MikanHandler(TorrentConfig torrentConfig, TorrentConfig.WebConfig config, HttpClientProvider httpClientProvider) {
        super(torrentConfig, config, httpClientProvider);
    }

    @Override
    public TorrentInfo queryDetail(String id) {
        String requestUrl = String.format("%s/Home/Episode/%s", baseUrl, id);
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(requestUrl))
                .GET()
                .build();
        String response = sendPlainTextRequest(request);
        Document document = Jsoup.parse(response);

        String name = Optional.ofNullable(document.selectFirst("p.episode-title")).map(Element::text).map(MikanHandler::unescapeHtml).orElse("");
        Date uploadTime = null;
        long size = 0L;
        Elements infos = document.select(".bangumi-info");
        for (Element info : infos) {
            String content = info.text();
            if(content.contains("发布日期：")){
                String uploadTimeStr = content.replace("发布日期：", "").trim();
                uploadTime = DateUtils.convertTimeStringToDate(uploadTimeStr, DateUtils.SLASH_SEPARATED_DATE_TIME_FORMAT_PADDED);
            } else if(content.contains("文件大小：")){
                size = UnitUtils.convertSizeUnit(content.replace("文件大小：", "").trim(), 0L);
            }
        }
        TorrentInfo torrentInfo = new TorrentInfo();
        torrentInfo.setId(id);
        torrentInfo.setName(name);
        torrentInfo.setHash(id.toUpperCase());
        torrentInfo.setSize(size);
        torrentInfo.setUploadTime(uploadTime);
        torrentInfo.setFileCount(null);
        torrentInfo.setFiles(null);

        return torrentInfo;
    }

    @Override
    public ScrollPageResult<TorrentInfo> search(String keyword, Long index, String sortField, String sortOrder) {
        String requestUrl = String.format("%s/Home/Search?searchstr=%s", baseUrl, URLEncoder.encode(keyword, StandardCharsets.UTF_8));
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(requestUrl))
                .GET()
                .build();
        String response = sendPlainTextRequest(request);
        if(response.contains("找不到对应结果")){
            return new ScrollPageResult<>(index, false, new ArrayList<>());
        }
        Document document = Jsoup.parse(response);
        List<TorrentInfo> torrentInfos = new ArrayList<>(pageSize());
        Elements trs = document.select("tbody tr.js-search-results-row");
        for (Element tr : trs) {
            Elements tds = tr.getElementsByTag("td");
            if (tds.size() != 6) {
                continue;
            }
            String hash = Patterns.extractFirstCapturedGroupContent(tds.get(0).html(), Patterns.MAGNET_HASH_PATTERN);
            String name = Optional.ofNullable(tds.get(1).selectFirst("a.magnet-link-wrap"))
                    .map(Element::text)
                    .map(MikanHandler::unescapeHtml)
                    .orElse("");
            String sizeStr = tds.get(2).text().trim();
            String updateTimeStr = tds.get(3).text().trim();

            TorrentInfo torrentInfo = new TorrentInfo();
            torrentInfo.setId(hash);
            torrentInfo.setName(name);
            torrentInfo.setHash(hash.toUpperCase());
            torrentInfo.setSize(UnitUtils.convertSizeUnit(sizeStr, 0L));
            torrentInfo.setUploadTime(DateUtils.convertTimeStringToDate(updateTimeStr, DateUtils.SLASH_SEPARATED_DATE_TIME_FORMAT_PADDED));
            torrentInfos.add(torrentInfo);
        }
        if(sortField != null && !sortField.isEmpty()){
            torrentInfos.sort((o1, o2) -> {
                if("name".equalsIgnoreCase(sortField)){
                    return sortReverse(sortOrder) ? o2.getName().compareTo(o1.getName()) : o1.getName().compareTo(o2.getName());
                }else if("uploadTime".equalsIgnoreCase(sortField)){
                    return sortReverse(sortOrder) ? o2.getUploadTime().compareTo(o1.getUploadTime()) : o1.getUploadTime().compareTo(o2.getUploadTime());
                }else if("size".equalsIgnoreCase(sortField)){
                    return sortReverse(sortOrder) ? Long.compare(o2.getSize(), o1.getSize()) : Long.compare(o1.getSize(), o2.getSize());
                }
                return 0;
            });
        }
        List<TorrentInfo> result = torrentInfos.stream().skip((index - 1) * pageSize()).limit(pageSize()).collect(Collectors.toList());
        boolean hasNext = torrentInfos.size() > index * pageSize() + result.size();
        return new ScrollPageResult<>(index, hasNext, result);
    }

    @Override
    public List<String> sortFields() {
        return Arrays.asList("name", "uploadTime", "size");
    }

    @Override
    public String code() {
        return "mikan";
    }

    @Override
    public List<String> tags() {
        return Arrays.asList("ACG");
    }

    @Override
    public int pageSize() {
        return 100;
    }

    public static String unescapeHtml(String html) {
        if (html == null || html.isEmpty()) {
            return html;
        }

        // 先处理普通命名实体
        String result = html
                .replace("&amp;", "&")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .replace("&apos;", "'")
                .replace("&nbsp;", " ");

        // 处理十六进制实体（如&#x3010;）
        result = processHexEntities(result);

        // 处理十进制实体（如&#1234;）
        result = processDecimalEntities(result);

        return result;
    }

    private static String processHexEntities(String input) {
        Matcher matcher = HEX_ENTITY_PATTERN.matcher(input);
        StringBuffer sb = new StringBuffer();

        while (matcher.find()) {
            String hexCode = matcher.group(1);
            try {
                // 将十六进制字符串转换为整数
                int codePoint = Integer.parseInt(hexCode, 16);
                // 检查是否为有效的Unicode代码点
                if (Character.isValidCodePoint(codePoint)) {
                    matcher.appendReplacement(sb, Character.toString((char) codePoint));
                } else {
                    // 无效代码点则保留原始内容
                    matcher.appendReplacement(sb, matcher.group(0));
                }
            } catch (NumberFormatException e) {
                // 转换失败则保留原始内容
                matcher.appendReplacement(sb, matcher.group(0));
            }
        }
        matcher.appendTail(sb);
        return sb.toString();
    }

    private static String processDecimalEntities(String input) {
        Matcher matcher = DECIMAL_ENTITY_PATTERN.matcher(input);
        StringBuffer sb = new StringBuffer();

        while (matcher.find()) {
            String decimalCode = matcher.group(1);
            try {
                // 将十进制字符串转换为整数
                int codePoint = Integer.parseInt(decimalCode);
                // 检查是否为有效的Unicode代码点
                if (Character.isValidCodePoint(codePoint)) {
                    matcher.appendReplacement(sb, Character.toString((char) codePoint));
                } else {
                    matcher.appendReplacement(sb, matcher.group(0));
                }
            } catch (NumberFormatException e) {
                matcher.appendReplacement(sb, matcher.group(0));
            }
        }
        matcher.appendTail(sb);
        return sb.toString();
    }

}
