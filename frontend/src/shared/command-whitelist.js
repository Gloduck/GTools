// 本机执行和 SSH 共用主命令白名单规则；风险判断由各执行入口处理。
export function normalizeCommandWhitelist(value) {
    const items = Array.isArray(value) ? value : String(value || '').split(/[\n,]/);
    // 不截断列表，避免扩展后的排查模板尾部命令被静默丢弃。
    return [...new Set(items.map((item) => String(item || '').trim()).filter(Boolean))];
}

export function normalizeMainCommandName(command) {
    const value = String(command || '').trim();
    return value && !/\s/.test(value) ? value : '';
}

export function normalizeMainCommands(commands) {
    return Array.isArray(commands) ? [...new Set(commands.map(normalizeMainCommandName).filter(Boolean))] : [];
}

export function areMainCommandsWhitelisted(whitelist, mainCommands) {
    const allowed = new Set(normalizeCommandWhitelist(whitelist).map(normalizeMainCommandName).filter(Boolean));
    // 保持原有精确匹配：不推断别名、大小写、路径或通配符的含义。
    return Array.isArray(mainCommands) && mainCommands.length > 0
        && mainCommands.every((command) => typeof command === 'string' && command !== '' && allowed.has(command));
}
