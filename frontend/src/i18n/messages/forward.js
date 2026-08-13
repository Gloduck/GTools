export const forwardMessages = {
    'zh-CN': {
        pages: {
            forward: { title: '转发下载工具', description: '通过转发服务器下载文件' }
        },
        forward: {
            title: '通过转发下载文件',
            description: '输入您想要下载的文件链接，系统将通过转发服务器为您下载该文件。支持各种类型的文件，包括文档、图片、视频等。',
            urlPlaceholder: '请输入文件下载链接...',
            downloading: '下载中...',
            startDownload: '开始下载',
            fileName: '文件名',
            progress: '下载进度',
            downloaded: '已下载',
            speed: '速度',
            history: '下载历史',
            emptyHistory: '暂无下载历史',
            invalidUrl: '请输入有效的 URL 地址',
            httpError: 'HTTP 错误: {status}{detail}',
            defaultFileName: '下载文件',
            downloadComplete: '下载完成',
            downloadFailed: '下载失败: {message}',
            downloadCancelled: '下载已取消',
            clearHistoryConfirm: '确定要清除所有下载历史吗？此操作不可恢复！',
            historyCleared: '下载历史已清空',
            clearHistoryFailed: '清除历史记录失败',
            status: {
                preparing: '准备下载...',
                connecting: '连接中...',
                downloading: '正在下载...',
                completed: '下载完成',
                failed: '下载失败: {message}',
                cancelled: '下载已取消'
            },
            historyStatus: {
                success: '完成',
                failed: '失败',
                cancelled: '取消'
            }
        }
    },
    'en-US': {
        pages: {
            forward: { title: 'Forward Download', description: 'Download files through a forwarding server' }
        },
        forward: {
            title: 'Download through forwarding',
            description: 'Enter a file URL and the forwarding server will download it for you. Documents, images, videos, and other file types are supported.',
            urlPlaceholder: 'Enter a file download URL...',
            downloading: 'Downloading...',
            startDownload: 'Start download',
            fileName: 'File name',
            progress: 'Download progress',
            downloaded: 'Downloaded',
            speed: 'Speed',
            history: 'Download history',
            emptyHistory: 'No download history',
            invalidUrl: 'Enter a valid URL',
            httpError: 'HTTP error: {status}{detail}',
            defaultFileName: 'downloaded_file',
            downloadComplete: 'Download complete',
            downloadFailed: 'Download failed: {message}',
            downloadCancelled: 'Download cancelled',
            clearHistoryConfirm: 'Clear all download history? This action cannot be undone.',
            historyCleared: 'Download history cleared',
            clearHistoryFailed: 'Failed to clear download history',
            status: {
                preparing: 'Preparing download...',
                connecting: 'Connecting...',
                downloading: 'Downloading...',
                completed: 'Download complete',
                failed: 'Download failed: {message}',
                cancelled: 'Download cancelled'
            },
            historyStatus: {
                success: 'Complete',
                failed: 'Failed',
                cancelled: 'Cancelled'
            }
        }
    }
};
