import {formatFileSize} from './file-utils.js';
import {currentLocale, t, translateErrorMessage} from '@/i18n/index.js';

const locale = () => currentLocale.value;

const CommonUtils = {
    createRandomUuid: () => {
        if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();

        const bytes = crypto.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },

    computePath: (basePath, basePathIsFile, expression) => {
        const normalizeSlashes = (p) => p.replace(/\\/g, '/');
        basePath = normalizeSlashes(basePath);
        expression = normalizeSlashes(expression);
        if (basePath !== '' && !basePath.endsWith("/")) {
            if (basePathIsFile) {
                basePath = basePath.slice(0, basePath.lastIndexOf("/") + 1);
            } else {
                basePath = basePath + "/";
            }
        }
        const addStack = (stack, parts) => {
            for (const expressionPart of parts) {
                if (expressionPart === "..") {
                    if (stack.length > 0) {
                        stack.pop();
                    } else {
                        throw new Error("path out of range");
                    }
                } else if (expressionPart === "." || expressionPart === "") {
                } else {
                    stack.push(expressionPart);
                }
            }
        }
        const stack = [];
        if (!expression.startsWith("/")) {
            addStack(stack, basePath.split("/"));
        }
        addStack(stack, expression.split("/"));

        const addSlash = basePath.startsWith("/") || expression.startsWith("/");
        return addSlash ? "/" + stack.join("/") : stack.join("/");
    },

    formatTime: (timeString) => {
        if (!timeString) return t('common.unknown');
        const date = new Date(timeString);
        return date.toLocaleString(locale(), {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    },

    formatRelativeTime: (timeString) => {
        if (!timeString) return t('common.unknown');
        const date = new Date(timeString);
        const diffSeconds = (date.getTime() - Date.now()) / 1000;
        const ranges = [
            ['year', 60 * 60 * 24 * 365],
            ['month', 60 * 60 * 24 * 30],
            ['week', 60 * 60 * 24 * 7],
            ['day', 60 * 60 * 24],
            ['hour', 60 * 60],
            ['minute', 60]
        ];
        const formatter = new Intl.RelativeTimeFormat(locale(), {numeric: 'auto'});
        for (const [unit, seconds] of ranges) {
            if (Math.abs(diffSeconds) >= seconds) {
                return formatter.format(Math.round(diffSeconds / seconds), unit);
            }
        }
        return formatter.format(Math.round(diffSeconds), 'second');
    },

    formatFileSize,

    truncateText: function (text, maxLength = 100) {
        if (!text) return text;
        if (text.length <= maxLength) {
            return text;
        }
        return text.substring(0, maxLength) + '...';
    },

    handleGithubApiError: (error, resultHandler) => {
        console.error('API请求错误:', error);
        let message = t('common.error.requestFailed');

        if (error?.message?.includes('API rate limit exceeded')) {
            message = t('common.error.githubRateLimit');
        } else if (error?.message) {
            message = translateErrorMessage(error.message);
        }

        if (resultHandler) {
            resultHandler(message, 'error');
        } else {
            alert(message);
        }
    },

    handleApiError: (error, resultHandler) => {
        console.error('API请求错误:', error);
        const message = translateErrorMessage(error?.message);

        if (resultHandler) {
            resultHandler(message, 'error');
        } else {
            alert(message);
        }
    },

    checkJsonResponseStatus: async (response) => {
        if (!response.ok) {
            const errorText = await response.text();
            let errorMessage = t('common.error.httpError', {status: response.status});

            try {
                const errorData = JSON.parse(errorText);
                errorMessage = translateErrorMessage(errorData.msg || errorData.message || errorMessage);
            } catch (e) {
                if (errorText.trim()) errorMessage = translateErrorMessage(errorText);
            }

            throw new Error(errorMessage);
        }
        const data = await response.json();
        if (data && typeof data === 'object' && data.msg) {
            data.msg = translateErrorMessage(data.msg);
        }
        return data;
    },

    debounce: (func, wait) => {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    copyToClipboard: (text, resultHandler) => {
        navigator.clipboard.writeText(text)
            .then(() => {
                if (resultHandler) {
                    resultHandler(t('common.copiedToClipboard'), 'success');
                }
            })
            .catch(err => {
                console.error('复制失败:', err);
                if (resultHandler) {
                    resultHandler(t('common.copyFailedManual'), 'error');
                }
            });
    }
};

export { CommonUtils };
