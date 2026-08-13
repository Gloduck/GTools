package cn.gloduck.api.service.torrent;

import cn.gloduck.api.entity.config.TorrentConfig;
import cn.gloduck.api.entity.model.torrent.TorrentHandlerInfo;
import cn.gloduck.api.entity.model.torrent.TorrentInfo;
import cn.gloduck.api.exceptions.ApiError;
import cn.gloduck.api.exceptions.ApiException;
import cn.gloduck.api.service.torrent.handler.*;
import cn.gloduck.common.entity.base.ScrollPageResult;
import jakarta.enterprise.context.ApplicationScoped;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.*;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.function.BiFunction;
import java.util.logging.Logger;

@ApplicationScoped
public class TorrentService {
    private static final Logger LOGGER = Logger.getLogger(TorrentService.class.getName());
    private final Map<String, Boolean> handlerStatusMap;
    private final List<TorrentHandler> torrentHandlers;
    private final ScheduledExecutorService scheduledExecutor;

    public TorrentService(TorrentConfig config) {
        this.config = config;
        this.torrentHandlers = new ArrayList<>();
        this.scheduledExecutor = Executors.newSingleThreadScheduledExecutor();
        tryInitHandler(config, config.btsow, BtsowHandler::new);
        tryInitHandler(config, config.extTo, ExtToHandler::new);
        tryInitHandler(config, config.dmhy, DmhyHandler::new);
        tryInitHandler(config, config.mikan, MikanHandler::new);
        tryInitHandler(config, config.sukebeiNyaaSi, SukebeiNyaaSiHandler::new);
        tryInitHandler(config, config.nyaaSi, NyaaSiHandler::new);
        tryInitHandler(config, config.tokyoToshokan, TokyoToshokanHandler::new);
        tryInitHandler(config, config.torrentkitty, TorrentkittyHandler::new);
        tryInitHandler(config, config.anybt, AnybtHandler::new);
        tryInitHandler(config, config.btDigg, BtDiggHandler::new);
        handlerStatusMap = new HashMap<>(torrentHandlers.size() / 3 * 4 + 1);
        scheduledExecutor.scheduleAtFixedRate(checkHandlerStatusTask(), 0, 30, TimeUnit.MINUTES);
    }

    private void tryInitHandler(TorrentConfig torrentConfig, TorrentConfig.WebConfig config, BiFunction<TorrentConfig, TorrentConfig.WebConfig, TorrentHandler> initializer) {
        if (config == null) {
            return;
        }
        checkConfig(torrentConfig, config);
        TorrentHandler handler = initializer.apply(torrentConfig, config);
        this.torrentHandlers.add(handler);
    }

    private void checkConfig(TorrentConfig torrentConfig, TorrentConfig.WebConfig config) {
        String url = config.url;
        if (url == null || url.isEmpty()) {
            throw new RuntimeException("URL is required");
        }

        try {
            new URI(url);
        } catch (URISyntaxException e) {
            throw new RuntimeException(e);
        }

        boolean bypassCf = Boolean.TRUE.equals(config.bypassCf);
        String bypassCfApi = torrentConfig.bypassCfApi;
        if (bypassCf && (bypassCfApi == null || bypassCfApi.isEmpty())) {
            throw new RuntimeException("BypassCf is required when bypassCf is true");
        }

        boolean useProxy = Boolean.TRUE.equals(config.useProxy);
        String proxy = !bypassCf ? torrentConfig.proxy : torrentConfig.bypassCfApiProxy;
        if (useProxy && (proxy == null || proxy.isEmpty())) {
            throw new RuntimeException("Proxy is required when useProxy is true");
        }
    }

    private Runnable checkHandlerStatusTask() {
        return () -> {
            for (TorrentHandler torrentHandler : torrentHandlers) {
                boolean available = torrentHandler.checkAvailable();
                handlerStatusMap.put(torrentHandler.code(), available);
            }
        };
    }

    public List<TorrentHandlerInfo> listHandlers() {
        List<TorrentHandlerInfo> res = new ArrayList<>(torrentHandlers.size());
        for (TorrentHandler torrentHandler : torrentHandlers) {
            TorrentHandlerInfo info = new TorrentHandlerInfo();
            info.setCode(torrentHandler.code());
            info.setUrl(torrentHandler.url());
            info.setAvailable(handlerStatusMap.getOrDefault(torrentHandler.code(), false));
            info.setSupportSortFields(torrentHandler.sortFields());
            info.setTags(torrentHandler.tags());
            res.add(info);
        }
        return res;
    }

    public TorrentInfo queryDetail(String id, String code) {
        TorrentHandler torrentHandler = torrentHandlers.stream()
                .filter(t -> t.code().equals(code))
                .findFirst()
                .orElseThrow(() -> new ApiException(ApiError.TORRENT_SOURCE_UNSUPPORTED));
        return torrentHandler.queryDetail(id);
    }

    public ScrollPageResult<TorrentInfo> search(Integer pageIndex, Integer pageSize, String keyword, String code, String sortField, String sortOrder) {
        // 参数校验
        if (pageSize == null || pageIndex == null || keyword == null || code == null) {
            throw new ApiException(ApiError.INVALID_PARAMETER);
        }

        // 获取对应的处理器
        TorrentHandler torrentHandler = torrentHandlers.stream()
                .filter(t -> t.code().equals(code))
                .findFirst()
                .orElseThrow(() -> new ApiException(ApiError.TORRENT_SOURCE_UNSUPPORTED));

        int handlerDefaultPageSize = torrentHandler.pageSize();
        List<TorrentInfo> combinedResults = new ArrayList<>();
        long startIndex = (long) (pageIndex - 1) * pageSize;
        int sourceStartPage = (int) (startIndex / handlerDefaultPageSize) + 1;
        int sourceOffset = (int) (startIndex % handlerDefaultPageSize);
        boolean lastHasNext;
        for (long i = sourceStartPage; ; i++) {
            long beforeSize = combinedResults.size();
            ScrollPageResult<TorrentInfo> searchResult;
            try {
                searchResult = torrentHandler.search(keyword, i, sortField, sortOrder);
            } catch (Exception e) {
                LOGGER.warning(String.format("Search api error: %s [index=%s; size=%s; keyword=%s; code=%s; sort=%s; order=%s]", e.getMessage(), pageIndex, pageSize, keyword, code, sortField, sortOrder));
                throw e;
            }
            List<TorrentInfo> items = searchResult.getItems();
            Boolean hasNext = searchResult.getHasNext();
            if (hasNext && items.size() != torrentHandler.pageSize()) {
                LOGGER.warning(String.format("Source %s has next page, the returned sizes do not match %s out of %s", code, torrentHandler.pageSize(), items.size()));
            }
            List<TorrentInfo> toAddResults;
            if (i == sourceStartPage) {
                // 跳过需要偏移的数据
                if (sourceOffset > items.size()) {
                    toAddResults = Collections.emptyList();
                } else {
                    toAddResults = items.subList(sourceOffset, items.size());
                }
            } else {
                toAddResults = items;
            }
            for (TorrentInfo toAddResult : toAddResults) {
                if (combinedResults.size() == pageSize) {
                    break;
                }
                combinedResults.add(toAddResult);
            }
            lastHasNext = hasNext || ((combinedResults.size() - beforeSize) < toAddResults.size());
//            System.out.printf("获取源%s页的数据, 预添加该页数据量: %d, 实际添加数据量: %d%n", i, toAddResults.size(), combinedResults.size() - beforeSize);

            // 已经获取到足够的数据或没有更多数据了就退出
            if (combinedResults.size() == pageSize || !lastHasNext) {
                break;
            }
        }
        return new ScrollPageResult<>((long) pageIndex, lastHasNext, combinedResults);
    }

    private final TorrentConfig config;
}
