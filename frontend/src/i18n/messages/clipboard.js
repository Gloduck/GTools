export const clipboardMessages = {
    'zh-CN': {
        pages: {
            clipboard: { title: '网络剪贴板', description: '在多台设备之间同步文本' }
        },
        clipboard: {
            title: '剪贴板:',
            lastUpdated: '最后更新: {time}',
            neverUpdated: '从未更新',
            autoCopy: '服务器更新时自动复制到剪贴板',
            autoRefresh: '自动刷新',
            autoSave: '自动保存',
            editorTitle: '内容编辑器',
            editorStatus: '状态: {status}',
            hintLabel: '提示:',
            editorHint: '使用 Ctrl+S 保存内容 | 内容会被明文保存到服务器，请不要保存敏感信息',
            idPlaceholder: '输入剪贴板 ID，例如: my-clipboard',
            go: '前往',
            createRandom: '创建随机剪贴板',
            instructions: '使用说明',
            instructionAccessTitle: '1. 创建或访问剪贴板',
            instructionAccessDescription: '输入一个唯一的剪贴板 ID（只能包含字母、数字和连字符）',
            instructionCreateTitle: '2. 自动创建',
            instructionCreateDescription: '如果剪贴板不存在，将会在第一次输入内容后自动创建',
            instructionSecurityTitle: '3. 安全提醒',
            instructionSecurityDescription: '内容会被明文存储在服务器上，请勿输入敏感信息',
            examplesTitle: '热门剪贴板示例',
            examples: {
                quickNotes: { name: '快速笔记', description: '用于临时记录笔记的剪贴板' },
                codeSnippets: { name: '代码片段', description: '共享有用的代码片段' },
                meetingMinutes: { name: '会议纪要', description: '团队会议记录和讨论' }
            },
            deleteConfirm: '确定要删除这个剪贴板吗？此操作不可撤销！',
            settingsSaveFailed: '保存设置失败',
            fetchFailed: '获取内容失败: {message}',
            saveSuccess: '内容保存成功!',
            saveFailed: '保存失败: {message}',
            deleteSuccess: '剪贴板已成功删除',
            deleteFailed: '删除失败: {message}',
            autoSaveSuccess: '内容已自动保存',
            enterId: '请输入剪贴板 ID',
            invalidId: 'ID 只能包含字母、数字和连字符',
            status: {
                ready: '就绪',
                editing: '跳过更新（编辑中）',
                fetching: '正在获取内容...',
                new: '新建',
                updated: '内容已更新',
                current: '内容已是最新',
                fetchFailed: '获取失败',
                saving: '正在保存...',
                saved: '保存成功',
                saveFailed: '保存失败',
                deleting: '正在删除...',
                deleted: '已删除',
                deleteFailed: '删除失败'
            }
        }
    },
    'en-US': {
        pages: {
            clipboard: { title: 'Online Clipboard', description: 'Synchronize text across devices' }
        },
        clipboard: {
            title: 'Clipboard:',
            lastUpdated: 'Last updated: {time}',
            neverUpdated: 'Never updated',
            autoCopy: 'Copy to the clipboard automatically when the server updates',
            autoRefresh: 'Auto refresh',
            autoSave: 'Auto save',
            editorTitle: 'Content editor',
            editorStatus: 'Status: {status}',
            hintLabel: 'Tip:',
            editorHint: 'Use Ctrl+S to save | Content is stored on the server as plain text. Do not save sensitive information.',
            idPlaceholder: 'Enter a clipboard ID, for example: my-clipboard',
            go: 'Go',
            createRandom: 'Create random clipboard',
            instructions: 'Instructions',
            instructionAccessTitle: '1. Create or open a clipboard',
            instructionAccessDescription: 'Enter a unique clipboard ID containing only letters, numbers, and hyphens.',
            instructionCreateTitle: '2. Automatic creation',
            instructionCreateDescription: 'If the clipboard does not exist, it will be created when content is first entered.',
            instructionSecurityTitle: '3. Security reminder',
            instructionSecurityDescription: 'Content is stored on the server as plain text. Do not enter sensitive information.',
            examplesTitle: 'Popular clipboard examples',
            examples: {
                quickNotes: { name: 'Quick notes', description: 'A clipboard for temporary notes' },
                codeSnippets: { name: 'Code snippets', description: 'Share useful code snippets' },
                meetingMinutes: { name: 'Meeting minutes', description: 'Team meeting records and discussions' }
            },
            deleteConfirm: 'Delete this clipboard? This action cannot be undone.',
            settingsSaveFailed: 'Failed to save settings',
            fetchFailed: 'Failed to fetch content: {message}',
            saveSuccess: 'Content saved successfully!',
            saveFailed: 'Failed to save: {message}',
            deleteSuccess: 'Clipboard deleted successfully',
            deleteFailed: 'Failed to delete: {message}',
            autoSaveSuccess: 'Content saved automatically',
            enterId: 'Enter a clipboard ID',
            invalidId: 'The ID may contain only letters, numbers, and hyphens',
            status: {
                ready: 'Ready',
                editing: 'Update skipped while editing',
                fetching: 'Fetching content...',
                new: 'New',
                updated: 'Content updated',
                current: 'Content is up to date',
                fetchFailed: 'Fetch failed',
                saving: 'Saving...',
                saved: 'Saved',
                saveFailed: 'Save failed',
                deleting: 'Deleting...',
                deleted: 'Deleted',
                deleteFailed: 'Delete failed'
            }
        }
    }
};
