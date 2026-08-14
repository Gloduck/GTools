import {formatFileSize} from './file-utils.js';

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

    formatTime: (time) => {
        if (time === null || time === undefined || time === '') return '';
        const date = new Date(time);
        if (Number.isNaN(date.getTime())) return '';
        const pad = (value) => String(value).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
            + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    },

    formatFileSize,

    truncateText: function (text, maxLength = 100) {
        if (!text) return text;
        if (text.length <= maxLength) {
            return text;
        }
        return text.substring(0, maxLength) + '...';
    },

    checkJsonResponseStatus: async (response) => {
        if (!response.ok) {
            const errorText = await response.text();
            let errorMessage = errorText.trim();
            let errorCode = '';

            try {
                const errorData = JSON.parse(errorText);
                errorCode = String(errorData?.msg || '').trim();
                errorMessage = String(errorData?.msg || errorData?.message || '').trim();
            } catch {
            }

            const error = new Error(errorMessage);
            error.name = 'HttpResponseError';
            error.status = response.status;
            error.statusText = response.statusText;
            error.body = errorText;
            if (errorCode) error.code = errorCode;
            throw error;
        }
        return response.json();
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

    copyToClipboard: (text) => navigator.clipboard.writeText(text)
};

export { CommonUtils };
