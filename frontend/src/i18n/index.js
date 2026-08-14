import { createI18n } from 'vue-i18n';
import { commonMessages } from './messages/common.js';
import { indexMessages } from './messages/index.js';
import { jrebelMessages } from './messages/jrebel.js';
import { imageEditorMessages } from './messages/image-editor.js';
import { forwardMessages } from './messages/forward.js';
import { clipboardMessages } from './messages/clipboard.js';
import { githubMessages } from './messages/github.js';
import { torrentMessages } from './messages/torrent.js';
import { mdEditorMessages } from './messages/md-editor.js';
import { codeEditorMessages } from './messages/code-editor.js';
import { fileTransferMessages } from './messages/file-transfer.js';

const DEFAULT_LOCALE = 'zh-CN';
const STORAGE_KEY = 'gtools-locale';
const CODE_EDITOR_STORAGE_KEY = 'browser-code-editor-settings';
const SUPPORTED_LOCALES = ['zh-CN', 'en-US'];

function normalizeLocale(locale) {
    const value = String(locale || '').trim().toLowerCase();
    if (value === 'zh' || value.startsWith('zh-')) return 'zh-CN';
    if (value === 'en' || value.startsWith('en-')) return 'en-US';
    return null;
}

function readStoredLocale() {
    try {
        const storedLocale = normalizeLocale(globalThis.localStorage?.getItem(STORAGE_KEY));
        if (storedLocale) return storedLocale;

        const editorSettings = JSON.parse(globalThis.localStorage?.getItem(CODE_EDITOR_STORAGE_KEY) || 'null');
        const editorLocale = normalizeLocale(editorSettings?.locale);
        if (editorLocale) return editorLocale;
    } catch {
    }
    return normalizeLocale(globalThis.navigator?.language) || DEFAULT_LOCALE;
}

function mergeMessages(target, source) {
    for (const [key, value] of Object.entries(source || {})) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            target[key] = mergeMessages({ ...(target[key] || {}) }, value);
        } else {
            target[key] = value;
        }
    }
    return target;
}

const messageModules = [
    commonMessages,
    indexMessages,
    jrebelMessages,
    imageEditorMessages,
    forwardMessages,
    clipboardMessages,
    githubMessages,
    torrentMessages,
    mdEditorMessages,
    codeEditorMessages,
    fileTransferMessages
];

const messages = Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [
    locale,
    messageModules.reduce((merged, module) => mergeMessages(merged, module[locale]), {})
]));

export const i18n = createI18n({
    legacy: false,
    locale: readStoredLocale(),
    fallbackLocale: DEFAULT_LOCALE,
    messages
});

export const currentLocale = i18n.global.locale;
export const t = (...args) => i18n.global.t(...args);

export function setLocale(locale) {
    const normalizedLocale = normalizeLocale(locale) || DEFAULT_LOCALE;
    currentLocale.value = normalizedLocale;
    if (globalThis.document?.documentElement) {
        document.documentElement.lang = normalizedLocale;
    }
    try {
        globalThis.localStorage?.setItem(STORAGE_KEY, normalizedLocale);
    } catch {
    }
    return normalizedLocale;
}

export function translateErrorMessage(message) {
    const rawMessage = message instanceof Error
        ? message.message
        : (message?.msg || message?.message || message);
    const readableMessage = String(rawMessage || '').trim();
    if (!readableMessage) return t('common.error.requestFailed');

    if (/^[A-Z][A-Z0-9_]*$/.test(readableMessage)) {
        const key = `errors.${readableMessage}`;
        return i18n.global.te(key, currentLocale.value) ? t(key) : t('common.error.requestFailed');
    }
    return readableMessage;
}

setLocale(currentLocale.value);
