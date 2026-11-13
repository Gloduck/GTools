// 执行器和 SSH 共用主命令白名单及审批规则。
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

// 导入冲突设置时优先保留审查，避免同时开启免审批而跳过审查。
export function normalizeCommandApprovalSettings(value = {}) {
    const autoReview = value.autoReview === true;
    return {autoReview, autoApprove: !autoReview && value.autoApprove === true};
}

// 审查模式覆盖所有命令，不依赖主 AI 自报的命令名单和风险判断。
export function getCommandApprovalReason({autoApprove = false, autoReview = false, whitelist, mainCommands, highRisk = false, hasUnsavedFiles = false} = {}) {
    if (autoReview === true) return 'auto-review';
    if (autoApprove === true) return null;
    if (highRisk) return 'high-risk';
    if (!areMainCommandsWhitelisted(whitelist, mainCommands)) return 'not-whitelisted';
    if (hasUnsavedFiles) return 'unsaved-files';
    return null;
}
