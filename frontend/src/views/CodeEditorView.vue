<template>
  <div class="code-editor-view app-shell" :class="[`theme-${settings.theme}`, { 'side-panel-hidden': !sidePanelVisible, resizing: sidebarResizing || previewResizing, 'preview-resizing': previewResizing }]" :style="{ '--side-panel-width': `${sidebarWidth}px`, '--preview-pane-width': `${previewWidth}px` }">
    <aside class="activity-bar" :aria-label="tr('nav.main')">
      <button class="activity-button" :class="{ active: activeView === 'explorer' }" :title="tr('activity.explorer')" :aria-label="tr('activity.explorer')" @click="showPanel('explorer')">
        <span class="codicon codicon-files" aria-hidden="true"></span>
      </button>
      <button class="activity-button" :class="{ active: activeView === 'search' }" :title="tr('activity.search')" :aria-label="tr('activity.search')" @click="showPanel('search')">
        <span class="codicon codicon-search" aria-hidden="true"></span>
      </button>
      <button class="activity-button" :class="{ active: activeView === 'changes' }" :title="tr('activity.changes')" :aria-label="tr('activity.changes')" @click="showPanel('changes')">
        <span class="codicon codicon-source-control" aria-hidden="true"></span>
      </button>
      <button class="activity-button" :class="{ active: activeView === 'ai' }" :title="tr('activity.ai')" :aria-label="tr('activity.ai')" @click="showPanel('ai')">
        <span class="codicon codicon-sparkle" aria-hidden="true"></span>
      </button>
      <button class="activity-button" :class="{ active: activeView === 'ssh' }" :title="tr('activity.ssh')" :aria-label="tr('activity.ssh')" @click="showPanel('ssh')">
        <span class="codicon codicon-terminal" aria-hidden="true"></span>
      </button>
      <button class="activity-button" :class="{ active: activeView === 'settings' }" :title="tr('activity.settings')" :aria-label="tr('activity.settings')" @click="showPanel('settings')">
        <span class="codicon codicon-settings-gear" aria-hidden="true"></span>
      </button>
    </aside>

    <aside class="side-panel">
      <section v-show="activeView === 'explorer'" class="panel-view active">
        <header class="panel-header">
          <div class="panel-title">
            <p class="eyebrow">{{ tr('activity.explorer') }}</p>
            <h1>{{ tr('panel.files') }}</h1>
            <small class="panel-workspace-name" :title="rootHandle ? rootName : tr('workspace.none')">{{ rootHandle ? rootName : tr('workspace.none') }}</small>
          </div>
          <button class="icon-button" :title="tr('action.refreshTree')" :aria-label="tr('action.refreshTree')" :disabled="!rootHandle" @click="refreshTree">
            <span class="codicon codicon-refresh" aria-hidden="true"></span>
          </button>
        </header>
        <div class="panel-actions">
          <button :title="tr('action.openFolder')" @click="openFolder">{{ tr('action.openFolder') }}</button>
          <button :title="tr('action.openBrowserFolder')" @click="openBrowserFolder">{{ tr('action.openBrowserFolder') }}</button>
          <button class="danger" :title="tr('action.clearBrowserFolder')" :disabled="rootKind !== 'opfs'" @click="clearBrowserFolder">{{ tr('action.clearBrowserFolder') }}</button>
        </div>
        <nav class="file-tree" :aria-label="tr('panel.files')" @contextmenu.prevent="showContextMenu($event, null)">
          <div v-if="!rootHandle" class="workspace-card">{{ tr('workspace.treeEmpty') }}</div>
          <TreeList v-else :nodes="tree" :depth="0" :active-path="activePath" :collapsed-paths="collapsedPaths" :dirty-paths="dirtyPathSet" @open-file="openFile" @toggle-dir="toggleDirectory" @context-node="showContextMenu" />
        </nav>
      </section>

      <section v-show="activeView === 'search'" class="panel-view active">
        <header class="panel-header">
          <div>
            <p class="eyebrow">{{ tr('activity.search') }}</p>
            <h1>{{ tr('panel.search') }}</h1>
          </div>
          <button class="icon-button" :title="tr('search.clear')" :aria-label="tr('search.clear')" :disabled="!searchQuery && searchResults.length === 0" @click="clearSearchResults">
            <span class="codicon codicon-clear-all" aria-hidden="true"></span>
          </button>
        </header>
        <form class="search-form" @submit.prevent="runGlobalSearch">
          <div class="search-row">
            <input v-model="searchQuery" type="search" :placeholder="tr('search.placeholder')" :disabled="!rootHandle || searchBusy" autocomplete="off" spellcheck="false" />
            <button type="button" class="search-option" :class="{ active: searchMatchCase }" :title="tr('search.matchCase')" :aria-label="tr('search.matchCase')" @click="searchMatchCase = !searchMatchCase">Aa</button>
            <button type="submit" :disabled="!rootHandle || searchBusy || !searchQuery.trim()">{{ searchBusy ? tr('search.running') : tr('search.submit') }}</button>
          </div>
          <div class="search-row replace-row">
            <input v-model="searchReplaceText" type="text" :placeholder="tr('search.replacePlaceholder')" :disabled="!rootHandle || searchBusy" autocomplete="off" spellcheck="false" />
            <button type="button" :disabled="!rootHandle || searchBusy || searchResults.length === 0" @click="replaceAllSearchResults">{{ tr('search.replaceAll') }}</button>
          </div>
        </form>
        <div class="search-results">
          <div v-if="!rootHandle" class="workspace-card">{{ tr('workspace.treeEmpty') }}</div>
          <div v-else-if="searchBusy" class="workspace-card">{{ tr('search.running') }}</div>
          <div v-else-if="searchSearched && searchResults.length === 0" class="workspace-card">{{ tr('search.noResults') }}</div>
          <div v-else-if="!searchSearched" class="workspace-card">{{ tr('search.empty') }}</div>
          <section v-for="result in searchResults" v-else :key="result.path" class="search-result-file">
            <button type="button" class="search-result-file-header" :title="result.path" @click="openFileByPath(result.path)">
              <span class="codicon" :class="getTreeIconClass({ name: result.name, kind: 'file' })" aria-hidden="true"></span>
              <span>{{ result.path }}</span>
              <small>{{ result.matches.length }}</small>
            </button>
            <button v-for="match in result.matches" :key="`${result.path}:${match.lineNumber}:${match.column}`" type="button" class="search-result-match" :title="match.lineText" @click="openSearchResult(result, match)">
              <small>{{ match.lineNumber }}</small>
              <span class="search-result-line">
                <template v-for="(segment, segmentIndex) in getSearchMatchSegments(match)" :key="segmentIndex">
                  <mark v-if="segment.match">{{ segment.text }}</mark>
                  <span v-else>{{ segment.text }}</span>
                </template>
              </span>
            </button>
          </section>
        </div>
      </section>

      <section v-show="activeView === 'changes'" class="panel-view active">
        <header class="panel-header">
          <div>
            <p class="eyebrow">{{ tr('activity.changes') }}</p>
            <h1>{{ tr('panel.changes') }}</h1>
          </div>
          <span class="change-count">{{ dirtyFiles.length }}</span>
        </header>
        <div class="changes-toolbar">
          <label class="change-select-all">
            <input type="checkbox" :checked="allChangesSelected" :disabled="dirtyFiles.length === 0" @change="toggleAllChangesSelection($event.target.checked)" />
            <span>{{ tr('changes.selectAll') }}</span>
          </label>
          <span>{{ tr('changes.selectedCount', { count: selectedChangeFiles.length }) }}</span>
          <button type="button" :disabled="selectedChangeFiles.length === 0" @click="saveSelectedChanges">{{ tr('changes.saveSelected') }}</button>
          <button type="button" :disabled="selectedChangeFiles.length === 0" @click="revertSelectedChanges">{{ tr('changes.revertSelected') }}</button>
        </div>
        <div class="changes-list">
          <div v-if="dirtyFiles.length === 0" class="workspace-card">{{ tr('changes.none') }}</div>
          <div v-for="file in dirtyFiles" :key="file.path" class="change-row" :class="{ active: file.path === activeDiffPath }" :title="tr('changes.openDiff')" role="button" tabindex="0" @click="activateDiff(file.path)" @keydown.enter.prevent="activateDiff(file.path)" @keydown.space.prevent="activateDiff(file.path)" @contextmenu.prevent="showChangesContextMenu($event, file)">
            <input type="checkbox" :checked="selectedChangePaths.has(file.path)" :aria-label="tr('changes.selectChange')" @click.stop @change="toggleChangeSelection(file.path, $event.target.checked)" />
            <span class="codicon" :class="file.deleted ? 'codicon-trash' : 'codicon-diff-modified'" aria-hidden="true"></span>
            <span class="change-main">
              <strong>{{ file.name }}</strong>
              <small>{{ file.deleted ? `${tr('changes.deleted')} · ${file.path}` : file.path }}</small>
            </span>
          </div>
        </div>
      </section>

      <section v-show="activeView === 'ai'" class="panel-view active ai-panel-view">
        <header class="panel-header ai-panel-header">
          <div>
            <p class="eyebrow">{{ tr('activity.ai') }}</p>
            <h1>{{ tr('panel.ai') }}</h1>
            <span class="ai-context-length">{{ tr('ai.contextLength', { count: aiContextLength }) }}</span>
          </div>
          <div class="ai-header-actions">
            <button class="icon-button" :title="tr('ai.switchSession')" :aria-label="tr('ai.switchSession')" @click.stop="openAiHistory">
              <span class="codicon codicon-history" aria-hidden="true"></span>
            </button>
            <button class="icon-button" :title="tr('ai.newSession')" :aria-label="tr('ai.newSession')" :disabled="!activeAiSession" @click="createAiSessionAndActivate">
              <span class="codicon codicon-add" aria-hidden="true"></span>
            </button>
            <button class="icon-button" :title="tr('ai.stop')" :aria-label="tr('ai.stop')" :disabled="!aiBusy" @click="stopAiTask">
              <span class="codicon codicon-debug-stop" aria-hidden="true"></span>
            </button>
          </div>
        </header>
        <div class="ai-session-toolbar" @click.stop>
          <div class="ai-session-identity">
            <input v-if="aiSessionTitleEditing" ref="aiSessionTitleInput" v-model="aiSessionTitle" class="ai-session-title-input" type="text" maxlength="80" :placeholder="tr('ai.sessionNamePlaceholder')" @blur="finishAiSessionTitleEdit" @keydown.enter.prevent="finishAiSessionTitleEdit" @keydown.esc.prevent="finishAiSessionTitleEdit" />
            <button v-else type="button" class="ai-session-title-button" :title="tr('ai.editSessionName')" @click="startAiSessionTitleEdit">
              {{ aiSessionTitle || tr('ai.newSessionDraft') }}
            </button>
            <div class="ai-session-meta">
              <span class="ai-session-save-status" :class="{ saved: activeAiSession && aiSessionSaved }">
                <span class="ai-session-status-dot" aria-hidden="true"></span>
                {{ activeAiSession ? (aiSessionSaved ? tr('ai.savedSession') : tr('ai.temporarySession')) : tr('ai.sessionDraft') }}
              </span>
              <span>{{ aiSessionAgentModel || tr('ai.noModel') }}</span>
              <span>{{ tr('ai.messageCount', { count: aiMessages.length }) }}</span>
            </div>
          </div>
          <button type="button" class="icon-button" :title="tr('ai.generateSessionName')" :aria-label="tr('ai.generateSessionName')" :disabled="aiBusy || aiMessages.length === 0" @click="generateAiSessionTitle">
            <span class="codicon" :class="activeAiSession?.titleBusy ? 'codicon-loading codicon-modifier-spin' : 'codicon-sparkle'" aria-hidden="true"></span>
          </button>
          <button type="button" class="icon-button" :class="{ active: aiSessionMenuVisible }" :title="tr('ai.moreActions')" :aria-label="tr('ai.moreActions')" @click="aiSessionMenuVisible = !aiSessionMenuVisible">
            <span class="codicon codicon-ellipsis" aria-hidden="true"></span>
          </button>
          <div v-if="aiSessionMenuVisible" class="ai-session-menu" role="menu" @click.stop>
            <label class="ai-session-menu-save">
              <input v-model="aiSessionSaved" type="checkbox" />
              <span>
                <strong>{{ tr('ai.saveSession') }}</strong>
                <small>{{ activeAiSession ? (aiSessionSaved ? tr('ai.savedSessionHint') : tr('ai.temporarySessionHint')) : tr('ai.sessionDraftSaveHint') }}</small>
              </span>
            </label>
            <div class="context-separator" aria-hidden="true"></div>
            <button type="button" role="menuitem" :disabled="aiBusy || aiMessages.length === 0" @click="runAiSessionMenuAction('compress')">{{ tr('ai.compressContext') }}</button>
            <button type="button" role="menuitem" :disabled="aiBusy || !canResetAiConversation" @click="runAiSessionMenuAction('reset')">{{ tr('ai.resetConversation') }}</button>
            <div class="context-separator" aria-hidden="true"></div>
            <button type="button" role="menuitem" class="danger" :disabled="aiBusy || !activeAiSession" @click="runAiSessionMenuAction('delete')">{{ tr('ai.deleteSession') }}</button>
          </div>
        </div>
        <div class="ai-chat">
          <div ref="aiMessagesEl" class="ai-chat-messages" @scroll.passive="handleAiMessagesScroll" @wheel.passive="handleAiMessagesWheel" @load.capture="scrollAiMessagesToBottom()">
            <div v-if="aiMessages.length === 0" class="workspace-card">{{ tr('ai.empty') }}</div>
            <article v-for="message in aiMessages" :key="message.id" class="ai-message" :class="`ai-message-${message.role}`">
              <template v-if="message.role === 'tool' && message.tool">
                <button type="button" class="ai-tool-toggle" @click="message.expanded = !message.expanded">
                  <span>{{ tr('ai.role.tool') }} · {{ message.tool.name }} · {{ message.tool.pending ? tr('ai.toolRunning') : (message.tool.cancelled ? tr('ai.toolCancelled') : (message.tool.ok ? tr('ai.toolSuccess') : tr('ai.toolError'))) }} · {{ message.tool.batchIndex }}/{{ message.tool.batchSize }}</span>
                  <span class="codicon" :class="message.tool.pending ? 'codicon-loading codicon-modifier-spin' : (message.tool.cancelled ? 'codicon-circle-slash' : (message.expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'))" aria-hidden="true"></span>
                </button>
                <div class="ai-message-content" v-html="renderMarkdown(message.content)"></div>
                <button v-if="message.imagePreview" type="button" class="ai-image-result" :title="message.imagePreview.path" @click="openFileByPath(message.imagePreview.path)">
                  <img :src="message.imagePreview.objectUrl" :alt="message.imagePreview.path" />
                  <span>{{ message.imagePreview.path }}</span>
                </button>
                <div v-if="message.expanded" class="ai-tool-details">
                  <div>
                    <strong>{{ tr('ai.toolArgs') }}</strong>
                    <pre>{{ formatJsonForDisplay(message.tool.args) }}</pre>
                  </div>
                  <div>
                    <strong>{{ tr('ai.toolResult') }}</strong>
                    <pre>{{ message.tool.pending ? tr('ai.toolRunning') : (message.tool.cancelled ? tr('ai.toolCancelled') : formatJsonForDisplay(message.tool.result)) }}</pre>
                  </div>
                </div>
              </template>
              <template v-else>
                <strong>{{ tr(`ai.role.${message.role}`) }}</strong>
                <div v-if="message.role === 'user'" class="ai-message-content ai-message-plain">{{ message.content }}</div>
                <div v-else class="ai-message-content" v-html="renderMarkdown(message.content)"></div>
              </template>
            </article>
          </div>
          <form class="ai-chat-form" @submit.prevent="sendAiPrompt">
            <textarea v-model="aiPrompt" :placeholder="tr('ai.placeholder')" :disabled="aiBusy" rows="4" @keydown="handleAiPromptKeydown"></textarea>
            <input ref="aiAttachmentInput" class="ai-attachment-input" type="file" multiple accept="text/*,image/png,image/jpeg,image/webp,.json,.js,.jsx,.ts,.tsx,.vue,.css,.scss,.html,.md,.xml,.yaml,.yml,.java,.py,.go,.rs,.c,.h,.cpp,.hpp,.cs,.php,.rb,.sh,.sql" @change="handleAiAttachmentSelection" />
            <div v-if="aiAttachments.length" class="ai-attachment-list">
              <span v-for="attachment in aiAttachments" :key="attachment.id" class="ai-attachment-chip" :title="attachment.name">
                <span class="codicon" :class="attachment.kind === 'image' ? 'codicon-file-media' : 'codicon-file-code'" aria-hidden="true"></span>
                <span>{{ attachment.name }}</span>
                <small>{{ FileUtils.formatFileSize(attachment.size) }}</small>
                <button type="button" :title="tr('ai.removeAttachment', { name: attachment.name })" :aria-label="tr('ai.removeAttachment', { name: attachment.name })" :disabled="aiBusy" @click="removeAiAttachment(attachment.id)">×</button>
              </span>
            </div>
            <div class="ai-chat-submit-row">
              <button type="button" class="ai-attach-button" :title="tr('ai.attachFiles')" :aria-label="tr('ai.attachFiles')" :disabled="aiBusy || aiAttachments.length >= AI_ATTACHMENT_MAX_COUNT" @click="aiAttachmentInput?.click()">
                <span class="codicon codicon-attach" aria-hidden="true"></span>
              </button>
              <button type="submit" :disabled="aiBusy || (!aiPrompt.trim() && aiAttachments.length === 0)">{{ aiBusy ? tr('ai.running') : tr('ai.send') }}</button>
            </div>
            <div class="ai-chat-options">
              <label>
                <span>{{ tr('ai.agentModel') }}</span>
                <select v-model="aiSessionAgentModel" :disabled="aiBusy">
                  <option v-for="model in aiAgentModelOptions" :key="`chat-agent-${model}`" :value="model">{{ model }}</option>
                </select>
              </label>
              <label>
                <span>{{ tr('ai.reasoningEffort') }}</span>
                <select v-model="aiSessionReasoningEffort" :disabled="aiBusy">
                  <option v-for="effort in aiReasoningEfforts" :key="effort" :value="effort">{{ tr(`ai.reasoning.${effort}`) }}</option>
                </select>
              </label>
            </div>
          </form>
        </div>
        <aside v-if="aiHistoryVisible" class="ai-history-drawer" :aria-label="tr('ai.sessions')" @click.stop @keydown.esc.prevent.stop="closeAiHistory">
          <header class="ai-history-header">
            <div>
              <p class="eyebrow">{{ tr('ai.sessions') }}</p>
              <h2>{{ tr('ai.sessions') }}</h2>
            </div>
            <button type="button" class="icon-button" :title="tr('ai.closeHistory')" :aria-label="tr('ai.closeHistory')" @click="closeAiHistory">
              <span class="codicon codicon-close" aria-hidden="true"></span>
            </button>
          </header>
          <div class="ai-history-search">
            <span class="codicon codicon-search" aria-hidden="true"></span>
            <input ref="aiHistorySearchInput" v-model="aiHistoryQuery" type="search" :placeholder="tr('ai.searchHistory')" autocomplete="off" spellcheck="false" />
          </div>
          <div class="ai-history-list">
            <div v-if="aiHistoryGroups.length === 0" class="workspace-card">{{ tr('ai.noMatchingSessions') }}</div>
            <section v-for="group in aiHistoryGroups" :key="group.label" class="ai-history-group">
              <h3>{{ group.label }}</h3>
              <article v-for="session in group.sessions" :key="session.id" class="ai-history-item" :class="{ active: session.id === activeAiSessionId }">
                <button type="button" class="ai-history-item-main" @click="activateAiHistorySession(session.id)">
                  <strong>{{ session.title }}</strong>
                  <small>
                    <span v-if="session.busy || session.titleBusy" class="codicon codicon-loading codicon-modifier-spin" aria-hidden="true"></span>
                    {{ formatAiSessionState(session) }} · {{ tr('ai.messageCount', { count: session.messages.length }) }} · {{ formatAiHistoryTime(session.updatedAt) }}
                  </small>
                </button>
                <button type="button" class="ai-history-delete" :title="tr('ai.deleteSession')" :aria-label="tr('ai.deleteSession')" :disabled="session.busy || session.titleBusy" @click="deleteAiSessionById(session.id)">
                  <span class="codicon codicon-trash" aria-hidden="true"></span>
                </button>
              </article>
            </section>
          </div>
        </aside>
      </section>

      <section v-show="activeView === 'ssh'" class="panel-view active">
        <header class="panel-header">
          <div>
            <p class="eyebrow">{{ tr('activity.ssh') }}</p>
            <h1>{{ tr('panel.ssh') }}</h1>
          </div>
          <button class="icon-button" :title="tr('ssh.add')" :aria-label="tr('ssh.add')" :disabled="!sshFeatureEnabled" @click="openCreateSshDialog">
            <span class="codicon codicon-add" aria-hidden="true"></span>
          </button>
        </header>
        <div v-if="!sshFeatureEnabled" class="workspace-card ssh-disabled-card">
          <strong>{{ tr('ssh.disabledTitle') }}</strong>
          <small>{{ tr('ssh.disabledDescription') }}</small>
        </div>
        <div class="ssh-list">
          <div v-if="settings.ssh.connections.length === 0" class="workspace-card">{{ tr('ssh.empty') }}</div>
          <article v-for="connection in settings.ssh.connections" :key="connection.id" class="ssh-card" :class="{ active: isSshConnected(connection.id) }">
            <div class="ssh-card-main">
              <span class="codicon" :class="isSshConnected(connection.id) ? 'codicon-debug-console' : 'codicon-terminal'" aria-hidden="true"></span>
              <div>
                <strong>{{ connection.name || connection.host }}</strong>
                <small>{{ connection.username }}@{{ connection.host }}:{{ connection.port || 22 }}</small>
              </div>
            </div>
            <div class="ssh-card-meta">
              <span>{{ tr(isSshConnected(connection.id) ? 'ssh.connected' : 'ssh.disconnected') }}</span>
              <span>{{ tr(connection.exposeToAi ? 'ssh.aiExposed' : 'ssh.aiHidden') }}</span>
            </div>
            <div class="ssh-card-actions">
              <button type="button" :disabled="!sshFeatureEnabled || isSshConnected(connection.id)" @click="connectSshConfig(connection)">{{ tr('ssh.connect') }}</button>
              <button type="button" :disabled="!isSshConnected(connection.id)" @click="disconnectSshConfig(connection.id)">{{ tr('ssh.disconnect') }}</button>
              <button type="button" :disabled="!sshFeatureEnabled || !isWorkspaceLoaded()" @click="openSftpDialog('upload', connection)">{{ tr('sftp.upload') }}</button>
              <button type="button" :disabled="!sshFeatureEnabled || !isWorkspaceLoaded()" @click="openSftpDialog('download', connection)">{{ tr('sftp.download') }}</button>
              <button type="button" :disabled="!sshFeatureEnabled" @click="openEditSshDialog(connection)">{{ tr('ssh.edit') }}</button>
              <button type="button" class="danger" :disabled="isSshConnected(connection.id)" @click="deleteSshConfig(connection.id)">{{ tr('ssh.delete') }}</button>
            </div>
          </article>
        </div>
        <section class="sftp-task-panel">
          <button type="button" class="sftp-task-toggle" @click="sftpTasksCollapsed = !sftpTasksCollapsed">
            <span>{{ tr('sftp.tasks') }} · {{ sftpTasks.length }}</span>
            <span class="codicon" :class="sftpTasksCollapsed ? 'codicon-chevron-right' : 'codicon-chevron-down'" aria-hidden="true"></span>
          </button>
          <div v-if="!sftpTasksCollapsed" class="sftp-task-list">
            <div v-if="sftpTasks.length === 0" class="workspace-card">{{ tr('sftp.noTasks') }}</div>
            <article v-for="task in sftpTasks" :key="task.id" class="sftp-task-card" :class="`sftp-task-${task.status}`">
              <div class="sftp-task-main">
                <strong>{{ tr(task.type === 'upload' ? 'sftp.upload' : 'sftp.download') }} · {{ task.connectionName }}</strong>
                <small>{{ task.localPath }} ⇄ {{ task.remotePath }}</small>
              </div>
              <div class="sftp-task-meta">
                <span>{{ tr(`sftp.status.${task.status}`) }}</span>
                <span>{{ formatSftpTaskProgress(task) }}</span>
              </div>
              <progress :value="task.total ? task.loaded : 0" :max="task.total || 1"></progress>
              <p v-if="task.error" class="sftp-task-error">{{ task.error }}</p>
              <button type="button" class="small-button" :disabled="!canCancelSftpTask(task)" @click="cancelSftpTask(task.id)">{{ tr('sftp.cancel') }}</button>
            </article>
          </div>
        </section>
      </section>

      <section v-show="activeView === 'settings'" class="panel-view active">
        <header class="panel-header">
          <div>
            <p class="eyebrow">{{ tr('panel.settings') }}</p>
            <h1>{{ tr('panel.settings') }}</h1>
          </div>
        </header>
        <div class="settings-list">
          <label class="setting-row">
            <span>{{ tr('settings.theme') }}</span>
            <select v-model="settings.theme" @change="applyTheme">
              <option value="vs-dark">{{ tr('theme.darkModern') }}</option>
              <option value="vs">{{ tr('theme.lightModern') }}</option>
              <option value="hc-black">{{ tr('theme.highContrast') }}</option>
            </select>
          </label>
          <label class="setting-row">
            <span>{{ tr('settings.locale') }}</span>
            <select :value="getCurrentLocale()" @change="applyLocale($event.target.value)">
              <option value="zh-CN">{{ tr('locale.zhCN') }}</option>
              <option value="en-US">{{ tr('locale.enUS') }}</option>
            </select>
          </label>
          <section class="setting-row keybinding-card">
            <div class="setting-title-row">
              <span>{{ tr('settings.ai') }}</span>
            </div>
            <label class="setting-row">
              <span>{{ tr('settings.aiApiKey') }}</span>
              <input v-model="settings.ai.apiKey" type="password" autocomplete="off" spellcheck="false" :placeholder="tr('settings.aiApiKeyPlaceholder')" />
            </label>
            <label class="setting-row">
              <span>{{ tr('settings.aiBaseUrl') }}</span>
              <input v-model="settings.ai.baseUrl" spellcheck="false" />
            </label>
            <label class="setting-row">
              <span>{{ tr('settings.npmRegistryUrl') }}</span>
              <input v-model="settings.ai.npmRegistryUrl" type="url" spellcheck="false" placeholder="https://registry.npmjs.org" />
            </label>
            <small class="setting-hint">{{ tr('settings.npmRegistryHint') }}</small>
            <button type="button" class="setting-action-button" :disabled="aiModelsLoading || !settings.ai.apiKey.trim()" @click="fetchAiModels">
              {{ aiModelsLoading ? tr('settings.aiModelsLoading') : tr('settings.aiFetchModels') }}
            </button>
            <label class="setting-row">
              <span>{{ tr('settings.aiCompletionModel') }}</span>
              <input v-model="settings.ai.completionModel" list="ai-model-options" spellcheck="false" />
            </label>
            <label class="setting-row">
              <span>{{ tr('settings.aiImageModel') }}</span>
              <input v-model="settings.ai.imageModel" list="ai-model-options" spellcheck="false" />
            </label>
            <label class="setting-row">
              <span>{{ tr('settings.aiAgentModel') }}</span>
              <input v-model="settings.ai.agentModels" spellcheck="false" :placeholder="tr('settings.aiAgentModelsPlaceholder')" @change="normalizeAgentModelsInput" />
            </label>
            <div class="setting-inline-row">
              <select v-model="agentModelToAdd" :aria-label="tr('settings.aiAgentModelToAdd')">
                <option value="">{{ tr('settings.aiAgentModelToAdd') }}</option>
                <option v-for="model in aiModelOptions" :key="`add-agent-${model}`" :value="model">{{ model }}</option>
              </select>
              <button type="button" :disabled="!agentModelToAdd" @click="addAgentModelFromSelect">{{ tr('settings.aiAddAgentModel') }}</button>
            </div>
            <datalist id="ai-model-options">
              <option v-for="model in aiModelOptions" :key="model" :value="model"></option>
            </datalist>
            <label class="setting-row checkbox-row">
              <input v-model="settings.ai.autoSaveSessions" type="checkbox" />
              <span>{{ tr('settings.aiAutoSaveSessions') }}</span>
            </label>
            <small class="setting-hint">{{ tr('settings.aiHint') }}</small>
          </section>
          <section class="setting-row keybinding-card">
            <div class="setting-title-row">
              <span>{{ tr('settings.backend') }}</span>
            </div>
            <label class="setting-row checkbox-row">
              <input v-model="settings.backend.enabled" type="checkbox" />
              <span>{{ tr('settings.backendEnabled') }}</span>
            </label>
            <label class="setting-row">
              <span>{{ tr('settings.backendBaseUrl') }}</span>
              <input v-model="settings.backend.baseUrl" spellcheck="false" :placeholder="defaultBackendSettings.baseUrl" @change="normalizeBackendBaseUrl" />
            </label>
            <small class="setting-hint">{{ tr('settings.backendHint') }}</small>
            <label class="setting-row">
              <span>{{ tr('settings.sshSecurityKey') }}</span>
              <input v-model="settings.ssh.securityKey" type="password" autocomplete="off" spellcheck="false" :placeholder="tr('settings.sshSecurityKeyPlaceholder')" />
            </label>
            <label class="setting-row">
              <span>{{ tr('settings.sshTerminalTheme') }}</span>
              <select v-model="settings.ssh.terminalTheme" @change="applySshTerminalTheme">
                <option v-for="theme in sshTerminalThemeOptions" :key="theme.value" :value="theme.value">{{ tr(theme.labelKey) }}</option>
              </select>
            </label>
            <label class="setting-row">
              <span>{{ tr('settings.sshWhitelistTemplate') }}</span>
              <textarea v-model="settings.ssh.whitelistTemplate" rows="5" spellcheck="false" :placeholder="DEFAULT_SSH_WHITELIST_TEMPLATE"></textarea>
            </label>
            <button type="button" class="setting-action-button" @click="resetSshWhitelistTemplate">{{ tr('settings.resetSshWhitelistTemplate') }}</button>
          </section>
          <section class="setting-row keybinding-card">
            <div class="setting-title-row">
              <span>{{ tr('settings.keybindings') }}</span>
              <button type="button" @click="resetKeybindings">{{ tr('settings.resetKeybindings') }}</button>
            </div>
            <label v-for="item in shortcutItems" :key="item.key" class="shortcut-row">
              <span>{{ tr(item.labelKey) }}</span>
              <input v-model="settings.shortcuts[item.key]" spellcheck="false" @change="updateKeybindings" />
            </label>
            <small class="setting-hint">{{ tr('settings.shortcutHint') }}</small>
          </section>
          <label class="setting-row">
            <span>{{ tr('settings.fontSize') }}</span>
            <input v-model.number="settings.fontSize" type="number" min="10" max="30" step="1" @change="applyEditorOptions" />
          </label>
          <label class="setting-row checkbox-row">
            <input v-model="settings.wordWrap" type="checkbox" @change="applyEditorOptions" />
            <span>{{ tr('settings.wordWrap') }}</span>
          </label>
          <label class="setting-row checkbox-row">
            <input v-model="settings.minimap" type="checkbox" @change="applyEditorOptions" />
            <span>{{ tr('settings.minimap') }}</span>
          </label>
          <label class="setting-row">
            <span>{{ tr('settings.maxMemoryReadMb') }}</span>
            <input v-model.number="maxMemoryReadMb" type="number" min="1" step="1" />
          </label>
          <label class="setting-row">
            <span>{{ tr('settings.maxMemoryWriteMb') }}</span>
            <input v-model.number="maxMemoryWriteMb" type="number" min="1" step="1" />
          </label>
          <section class="setting-row keybinding-card">
            <div class="setting-title-row">
              <span>{{ tr('settings.exportUrl') }}</span>
              <button type="button" @click="exportSettingsUrl">{{ tr('settings.copyExportUrl') }}</button>
            </div>
            <small class="setting-hint">{{ tr('settings.exportUrlHint') }}</small>
          </section>
        </div>
      </section>
      <div class="side-panel-resizer" role="separator" aria-orientation="vertical" :aria-valuenow="sidebarWidth" :aria-valuemin="SIDEBAR_MIN_WIDTH" :aria-valuemax="SIDEBAR_MAX_WIDTH" @pointerdown="startSidebarResize"></div>
    </aside>

    <main class="editor-shell">
      <div class="command-bar">
        <button type="button" class="command-center" :title="tr('commandCenter.title')" :aria-label="tr('commandCenter.title')" @click="openCommandPalette">
          <span class="codicon codicon-search" aria-hidden="true"></span>
          <span class="command-center-label">{{ tr('commandCenter.placeholder') }}</span>
          <span class="command-center-shortcut">{{ settings.shortcuts.commandPalette }}</span>
        </button>
        <button type="button" class="command-icon-button" :title="tr('action.findReferences')" :aria-label="tr('action.findReferences')" :disabled="!activeFile" @click="triggerFindReferences">
          <span class="codicon codicon-references" aria-hidden="true"></span>
        </button>
        <button type="button" class="command-icon-button" :class="{ active: activeFilePreviewVisible }" :title="tr('action.preview')" :aria-label="tr('action.preview')" :disabled="!activeFilePreviewVisible && !canPreviewActiveFile" @click="togglePreview">
          <span class="codicon codicon-open-preview" aria-hidden="true"></span>
        </button>
      </div>
      <div class="tabs" role="tablist">
        <button v-for="file in openFileList" :key="file.path" class="tab" :class="{ active: file.path === activePath && !activeDiffPath && !activeSshTerminal }" :title="file.path" role="tab" :aria-selected="file.path === activePath && !activeDiffPath && !activeSshTerminal" @click="activateFile(file.path)" @auxclick.middle="closeFile(file.path)">
          <span class="tab-name">{{ file.name }}</span>
          <span class="dirty-dot">{{ file.dirty ? '•' : '' }}</span>
          <span class="tab-close" :title="tr('action.close')" @click.stop="closeFile(file.path)">×</span>
        </button>
        <button v-for="terminal in sshTerminalTabs" :key="`ssh:${terminal.configId}`" class="tab ssh-tab" :class="{ active: terminal.configId === activeSshTerminalId }" :title="terminal.title" role="tab" :aria-selected="terminal.configId === activeSshTerminalId" @click="activateSshTerminal(terminal.configId)" @auxclick.middle="closeSshTerminalTab(terminal.configId)">
          <span class="codicon codicon-terminal" aria-hidden="true"></span>
          <span class="tab-name">{{ terminal.title }}</span>
          <span class="dirty-dot">{{ terminal.connected ? '●' : '' }}</span>
          <span class="tab-close" :title="tr('action.close')" @click.stop="closeSshTerminalTab(terminal.configId)">×</span>
        </button>
      </div>

      <section class="editor-stage" :class="{ 'preview-open': previewPaneVisible }">
        <div v-show="!activePath && !activeDiffPath && !activeSshTerminal" class="empty-state">
          <h2>{{ tr('empty.title') }}</h2>
          <p>{{ tr('empty.description') }}</p>
          <button @click="openFolder">{{ tr('action.openFolder') }}</button>
        </div>
        <div ref="editorHost" class="monaco-host" :class="{ visible: activeTextFile && !activeDiffPath && !activeSshTerminal }" :aria-label="tr('editor.aria')"></div>
        <div v-if="displayedImageFile && !activeSshTerminal" class="image-preview" :aria-label="tr('imagePreview.aria')" @click="focusActivePreviewEditor">
          <img :src="displayedImageFile.objectUrl" :alt="displayedImageFile.name" />
          <div class="image-preview-meta">
            <strong>{{ displayedImageFile.name }}</strong>
            <span>{{ FileUtils.formatFileSize(displayedImageFile.size) }} · {{ displayedImageFile.mimeType || tr('imagePreview.type') }}</span>
          </div>
        </div>
        <div v-if="activeUnsupportedFile && !activeDiffPath && !activeSshTerminal" class="unsupported-preview" :aria-label="tr('unsupportedFile.aria')" @click="focusActivePreviewEditor">
          <span class="codicon codicon-warning" aria-hidden="true"></span>
          <h2>{{ tr('unsupportedFile.title') }}</h2>
          <p>{{ tr('unsupportedFile.description') }}</p>
          <small>{{ activeUnsupportedFile.path }} · {{ FileUtils.formatFileSize(activeUnsupportedFile.size) }}{{ activeUnsupportedFile.mimeType ? ` · ${activeUnsupportedFile.mimeType}` : '' }}</small>
        </div>
        <div v-if="activeDiffUnsupportedFile && !activeSshTerminal" class="unsupported-preview diff-placeholder" :aria-label="tr('diff.aria')" @click="focusActivePreviewEditor">
          <span class="codicon codicon-diff-modified" aria-hidden="true"></span>
          <h2>{{ tr('diff.unsupportedTitle') }}</h2>
          <p>{{ tr('diff.unsupportedDescription') }}</p>
          <small>{{ activeDiffUnsupportedFile.path }} · {{ activeDiffUnsupportedFile.deleted ? tr('changes.deleted') : tr('status.unsaved') }}</small>
        </div>
        <div ref="diffHost" class="monaco-host diff-host" :class="{ visible: activeDiffPath && !activeDiffUnsupportedFile && !activeDiffImageFile && !activeSshTerminal }" :aria-label="tr('diff.aria')"></div>
        <section v-if="activeSshTerminal" class="ssh-terminal" :aria-label="tr('ssh.terminal')">
          <header class="ssh-terminal-header">
            <span>{{ activeSshTerminal.title }}</span>
            <small>{{ tr(activeSshTerminal.connected ? 'ssh.connected' : 'ssh.disconnected') }}</small>
          </header>
          <div v-show="activeSshTerminal.terminal" ref="sshTerminalHost" class="ssh-terminal-host"></div>
          <pre v-if="!activeSshTerminal.terminal" class="ssh-terminal-fallback">{{ activeSshTerminal.output || tr('ssh.noOutput') }}</pre>
        </section>
        <aside v-if="previewPaneVisible && !activeSshTerminal" class="preview-pane" :aria-label="tr('preview.aria')">
          <div class="preview-pane-resizer" role="separator" aria-orientation="vertical" :aria-valuenow="previewWidth" :aria-valuemin="PREVIEW_MIN_WIDTH" :aria-valuemax="PREVIEW_MAX_WIDTH" @pointerdown="startPreviewResize"></div>
          <header class="preview-header">
            <span>{{ tr(previewLabelKey) }}</span>
            <div class="preview-header-actions">
              <a v-if="previewPageUrl" class="icon-button preview-external-link" :href="previewPageUrl" target="_blank" rel="noopener noreferrer" :title="tr('preview.openNewTab')" :aria-label="tr('preview.openNewTab')">
                <span class="codicon codicon-link-external" aria-hidden="true"></span>
              </a>
              <button type="button" class="icon-button" :title="tr('action.close')" :aria-label="tr('action.close')" @click="closePreview()">
                <span class="codicon codicon-close" aria-hidden="true"></span>
              </button>
            </div>
          </header>
          <iframe ref="previewFrame" :key="previewFrameKey" class="preview-frame" :sandbox="PREVIEW_FRAME_SANDBOX" :srcdoc="previewContent"></iframe>
        </aside>
      </section>

      <footer class="status-bar">
        <div class="status-left-group">
          <span id="status-left">{{ status.left }}</span>
          <button id="save-file" :disabled="!activeFile?.dirty || activeSshTerminal" @click="saveActiveFile">{{ tr('status.saveButton', { shortcut: settings.shortcuts.save }) }}</button>
        </div>
        <div class="status-right-group">
          <span id="status-right">{{ status.right }}</span>
          <select v-model="activeLanguage" :disabled="!activeTextFile || activeFile.deleted || activeSshTerminal" :aria-label="tr('status.language')" @change="changeActiveLanguage">
            <option v-for="language in languageOptions" :key="language.id" :value="language.id">{{ language.labelKey ? tr(language.labelKey) : language.label }}</option>
          </select>
        </div>
      </footer>
    </main>

    <div v-show="contextMenu.visible" class="context-menu visible" role="menu" :aria-label="tr('menu.fileTree')" :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }" @click.stop>
      <button type="button" role="menuitem" @click="runContextAction('new-file')">{{ tr('action.newFile') }}</button>
      <button type="button" role="menuitem" @click="runContextAction('new-folder')">{{ tr('action.newFolder') }}</button>
      <div class="context-separator" aria-hidden="true"></div>
      <button type="button" role="menuitem" :disabled="!contextMenu.node" @click="runContextAction('save-as')">{{ tr('action.saveAs') }}</button>
      <button type="button" role="menuitem" :disabled="!canRunPersistentNodeAction(contextMenu.node, 'rename')" @click="runContextAction('rename')">{{ tr('action.rename') }}</button>
      <button type="button" role="menuitem" :disabled="!canRunPersistentNodeAction(contextMenu.node, 'move')" @click="runContextAction('move')">{{ tr('action.move') }}</button>
      <button type="button" role="menuitem" :disabled="!canRunPersistentNodeAction(contextMenu.node, 'copy')" @click="runContextAction('copy')">{{ tr('action.copy') }}</button>
      <div class="context-separator" aria-hidden="true"></div>
      <button type="button" role="menuitem" class="danger" :disabled="!contextMenu.node" @click="runContextAction('delete')">{{ tr('action.delete') }}</button>
      <div class="context-separator" aria-hidden="true"></div>
      <button type="button" role="menuitem" @click="runContextAction('refresh')">{{ tr('action.refreshTree') }}</button>
    </div>

    <div v-show="changesContextMenu.visible" class="context-menu visible" role="menu" :aria-label="tr('menu.changes')" :style="{ left: `${changesContextMenu.x}px`, top: `${changesContextMenu.y}px` }" @click.stop>
      <button type="button" role="menuitem" @click="runChangesContextAction('open-diff')">{{ tr('changes.openDiff') }}</button>
      <div class="context-separator" aria-hidden="true"></div>
      <button type="button" role="menuitem" class="danger" @click="runChangesContextAction('revert')">{{ tr('action.revert') }}</button>
    </div>

    <div v-if="dialogState.visible" class="editor-dialog-backdrop" role="presentation" @click.self="dialogState.closeOnBackdrop && cancelDialog()">
      <form class="editor-dialog" role="dialog" aria-modal="true" aria-labelledby="editor-dialog-title" @submit.prevent="confirmDialog" @keydown.esc.prevent.stop="cancelDialog" @click.stop>
        <div class="editor-dialog-header">
          <span class="codicon" :class="dialogIconClass" aria-hidden="true"></span>
          <h2 id="editor-dialog-title">{{ dialogState.title }}</h2>
        </div>
        <p class="editor-dialog-message">{{ dialogState.message }}</p>
        <label v-if="isPromptDialogMode(dialogState.mode)" class="editor-dialog-input-row">
          <span>{{ dialogState.inputLabel }}</span>
          <input ref="dialogInput" v-model="dialogState.value" type="text" :placeholder="dialogState.placeholder" autocomplete="off" spellcheck="false" />
        </label>
        <label v-if="isSelectDialogMode(dialogState.mode)" class="editor-dialog-input-row">
          <span>{{ dialogState.inputLabel }}</span>
          <select ref="dialogSelect" v-model="dialogState.value">
            <option v-for="option in dialogState.selectOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
        <label v-if="dialogState.optionLabel" class="editor-dialog-option" :class="{ disabled: dialogState.optionDisabled }">
          <input ref="dialogOptionInput" v-model="dialogState.optionChecked" type="checkbox" :disabled="dialogState.optionDisabled" />
          <span class="editor-dialog-option-copy">
            <strong>{{ dialogState.optionLabel }}</strong>
            <small v-if="dialogState.optionHint">{{ dialogState.optionHint }}</small>
          </span>
        </label>
        <div class="editor-dialog-actions">
          <button v-if="dialogState.mode !== 'alert'" type="button" @click="cancelDialog">{{ dialogState.cancelLabel }}</button>
          <button ref="dialogPrimaryButton" type="submit" class="primary" :class="{ danger: dialogState.tone === 'danger' }">{{ dialogState.confirmLabel }}</button>
        </div>
      </form>
    </div>

    <div v-if="sshDialog.visible" class="editor-dialog-backdrop" role="presentation" @click.self="closeSshDialog">
      <form class="editor-dialog ssh-dialog" role="dialog" aria-modal="true" aria-labelledby="ssh-dialog-title" @submit.prevent="saveSshDialog" @keydown.esc.prevent.stop="closeSshDialog" @click.stop>
        <div class="editor-dialog-header">
          <span class="codicon codicon-terminal" aria-hidden="true"></span>
          <h2 id="ssh-dialog-title">{{ sshDialog.mode === 'edit' ? tr('ssh.editTitle') : tr('ssh.addTitle') }}</h2>
        </div>
        <label class="setting-row">
          <span>{{ tr('ssh.name') }}</span>
          <input v-model="sshDialog.draft.name" required autocomplete="off" spellcheck="false" />
        </label>
        <div class="ssh-dialog-grid">
          <label class="setting-row">
            <span>{{ tr('ssh.host') }}</span>
            <input v-model="sshDialog.draft.host" required autocomplete="off" spellcheck="false" />
          </label>
          <label class="setting-row">
            <span>{{ tr('ssh.port') }}</span>
            <input v-model.number="sshDialog.draft.port" type="number" min="1" max="65535" required />
          </label>
        </div>
        <label class="setting-row">
          <span>{{ tr('ssh.username') }}</span>
          <input v-model="sshDialog.draft.username" required autocomplete="off" spellcheck="false" />
        </label>
        <label class="setting-row">
          <span>{{ tr('ssh.authType') }}</span>
          <select v-model="sshDialog.draft.authType">
            <option value="password">{{ tr('ssh.authPassword') }}</option>
            <option value="privateKey">{{ tr('ssh.authPrivateKey') }}</option>
          </select>
        </label>
        <label v-if="sshDialog.draft.authType === 'password'" class="setting-row">
          <span>{{ tr('ssh.password') }}</span>
          <input v-model="sshDialog.draft.password" type="password" autocomplete="off" />
        </label>
        <template v-else>
          <label class="setting-row">
            <span>{{ tr('ssh.privateKey') }}</span>
            <textarea v-model="sshDialog.draft.privateKey" rows="5" spellcheck="false"></textarea>
          </label>
          <label class="setting-row">
            <span>{{ tr('ssh.passphrase') }}</span>
            <input v-model="sshDialog.draft.passphrase" type="password" autocomplete="off" />
          </label>
        </template>
        <label class="setting-row checkbox-row">
          <input v-model="sshDialog.draft.exposeToAi" type="checkbox" />
          <span>{{ tr('ssh.exposeToAi') }}</span>
        </label>
        <label class="setting-row">
          <span class="setting-title-row">
            <span>{{ tr('ssh.whitelist') }}</span>
            <button type="button" @click="applySshWhitelistTemplateToDialog">{{ tr('ssh.applyWhitelistTemplate') }}</button>
          </span>
          <textarea v-model="sshDialog.draft.whitelistText" rows="3" spellcheck="false" :placeholder="tr('ssh.whitelistPlaceholder')"></textarea>
        </label>
        <small class="setting-hint">{{ tr('ssh.aiHint') }}</small>
        <div class="editor-dialog-actions">
          <button type="button" @click="closeSshDialog">{{ tr('dialog.cancel') }}</button>
          <button type="submit" class="primary">{{ tr('dialog.ok') }}</button>
        </div>
      </form>
    </div>

    <div v-if="sftpDialog.visible" class="editor-dialog-backdrop" role="presentation" @click.self="closeSftpDialog">
      <form class="editor-dialog sftp-dialog" role="dialog" aria-modal="true" aria-labelledby="sftp-dialog-title" @submit.prevent="submitSftpDialog" @keydown.esc.prevent.stop="closeSftpDialog" @click.stop>
        <div class="editor-dialog-header">
          <span class="codicon" :class="sftpDialog.mode === 'upload' ? 'codicon-cloud-upload' : 'codicon-cloud-download'" aria-hidden="true"></span>
          <h2 id="sftp-dialog-title">{{ tr(sftpDialog.mode === 'upload' ? 'sftp.uploadTitle' : 'sftp.downloadTitle') }}</h2>
        </div>
        <p class="editor-dialog-message">{{ tr('sftp.dialogHint', { name: sftpDialog.connectionName }) }}</p>
        <label class="setting-row">
          <span>{{ tr('sftp.localPath') }}</span>
          <input v-model="sftpDialog.localPath" required autocomplete="off" spellcheck="false" :placeholder="tr('sftp.localPathPlaceholder')" />
        </label>
        <label class="setting-row">
          <span>{{ tr('sftp.remotePath') }}</span>
          <input v-model="sftpDialog.remotePath" required autocomplete="off" spellcheck="false" placeholder="/tmp/file.bin" />
        </label>
        <label v-if="sftpDialog.mode === 'upload'" class="setting-row checkbox-row">
          <input v-model="sftpDialog.useUnsaved" type="checkbox" />
          <span>{{ tr('sftp.useUnsaved') }}</span>
        </label>
        <div class="editor-dialog-actions">
          <button type="button" @click="closeSftpDialog">{{ tr('dialog.cancel') }}</button>
          <button type="submit" class="primary">{{ tr(sftpDialog.mode === 'upload' ? 'sftp.upload' : 'sftp.download') }}</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { computed, defineComponent, h, markRaw, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from "vue";
import { runAiNodeWorker } from "@/shared/ai-node-worker.js";
import { runFilterScript } from "@/shared/filter-script-worker.js";
import {
  FileUtils,
  getMimeType,
  getParentFilePath,
  isPathUnder,
  joinFilePath,
  normalizeFilePath,
} from "@/shared/file-utils.js";
import { MarkdownUtils } from "@/shared/markdown-utils.js";
import { NetworkLimit } from "@/shared/network-limit.js";
import { enableEditorPwa } from "@/shared/pwa-install.js";
import { downloadDirectory, downloadFile } from "@/shared/file-downloader.js";
import { RequestProxy } from "@/shared/request-proxy.js";
import { AiCredentialStore } from "@/shared/ai-credential-store.js";
import { currentLocale, setLocale, t, translateErrorMessage } from "@/i18n/index.js";
import { codeEditorMessages } from "@/i18n/messages/code-editor.js";
import {
  createFileSystem,
  FileConflictError,
  FileOperationPolicy,
  FileSession,
  FileTooLargeError,
} from "@/shared/file-system/index.js";

const STORAGE_KEY = "browser-code-editor-settings";
const CODE_EDITOR_WEB_PATH = "/codeEditor";
const CODE_EDITOR_PWA_PATH = "/codeEditor/pwa/";
const AI_SESSION_DATABASE_NAME = "browser-code-editor";
const AI_SESSION_DATABASE_VERSION = 1;
const AI_SESSION_STORE_NAME = "aiSessions";
const SETTINGS_URL_PARAM = "settings";
const MEBIBYTE = 1024 * 1024;
const DEFAULT_MAX_MEMORY_READ_BYTES = 50 * MEBIBYTE;
const DEFAULT_MAX_MEMORY_WRITE_BYTES = 50 * MEBIBYTE;
const SSH_WEBSOCKET_PATH = "/api/ssh/ws";
const SFTP_UPLOAD_PATH = "/api/ssh/sftp/upload";
const SFTP_DOWNLOAD_PATH = "/api/ssh/sftp/download";
const MONACO_BASE_URL = `${import.meta.env.BASE_URL}vendor/monaco/0.55.1/vs`;
const LEGACY_AI_COMPLETE_SHORTCUT = "Ctrl+Shift+Enter";
const LEGACY_FOLD_ALL_SHORTCUT = "Ctrl+K Ctrl+0";
const LEGACY_UNFOLD_ALL_SHORTCUT = "Ctrl+K Ctrl+J";
const vscodeShortcuts = { save: "Ctrl+S", format: "Shift+Alt+F", commandPalette: "Ctrl+P", search: "Ctrl+Shift+F", findReferences: "Shift+F12", preview: "Ctrl+Shift+V", toggleSidebar: "Ctrl+B", fold: "Ctrl+Shift+[", unfold: "Ctrl+Shift+]", foldAll: "Ctrl+Alt+[", unfoldAll: "Ctrl+Alt+]", aiComplete: "Ctrl+Alt+Enter" };
const defaultAiSettings = { apiKey: "", baseUrl: "https://api.openai.com/v1", npmRegistryUrl: "", completionModel: "gpt-5.4-mini", imageModel: "gpt-image-1", agentModels: "gpt-5.5,gpt-5.4-mini", reasoningEffort: "default", autoSaveSessions: false };
const defaultBackendSettings = { enabled: false, baseUrl: getCurrentBackendBaseUrl() };
const DEFAULT_SSH_WHITELIST_TEMPLATE = [
  "pwd", "ls", "cat", "less", "more", "head", "tail", "grep", "egrep", "fgrep", "awk", "sed", "sort", "uniq", "wc", "cut", "tr", "tee", "xargs", "find", "stat", "file", "readlink", "realpath", "basename", "dirname", "tree",
  "env", "printenv", "set", "locale", "which", "whereis", "type", "command", "history", "alias",
  "whoami", "id", "groups", "who", "w", "last", "lastlog", "date", "uptime", "hostname", "uname", "arch", "lscpu", "lsmem", "lsblk", "lspci", "lsusb", "dmidecode", "dmesg",
  "ps", "pstree", "pgrep", "top", "htop", "free", "vmstat", "iostat", "mpstat", "sar", "pidstat", "pmap", "lsof", "strace",
  "df", "du", "mount", "findmnt", "blkid", "lsattr", "getfacl",
  "ip", "ss", "netstat", "ping", "traceroute", "tracepath", "dig", "nslookup", "host", "curl", "wget", "nc", "telnet", "arp", "route",
  "systemctl", "service", "journalctl", "loginctl", "timedatectl", "resolvectl", "crontab",
  "apt-cache",
].join("\n");
const defaultSshSettings = { securityKey: "", terminalTheme: "dark", whitelistTemplate: DEFAULT_SSH_WHITELIST_TEMPLATE, connections: [] };
const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 640;
const DEFAULT_SIDEBAR_WIDTH = 300;
const PREVIEW_MIN_WIDTH = 280;
const PREVIEW_MAX_WIDTH = 900;
const DEFAULT_PREVIEW_WIDTH = 480;
const AI_MESSAGES_BOTTOM_TOLERANCE_PX = 2;
const defaultSettings = { theme: "vs-dark", locale: "zh-CN", fontSize: 14, wordWrap: false, minimap: true, maxMemoryReadBytes: DEFAULT_MAX_MEMORY_READ_BYTES, maxMemoryWriteBytes: DEFAULT_MAX_MEMORY_WRITE_BYTES, shortcuts: { ...vscodeShortcuts }, ai: { ...defaultAiSettings }, backend: { ...defaultBackendSettings }, ssh: { ...defaultSshSettings } };

class AiSessionStore {
  constructor() {
    this.databasePromise = null;
  }

  async list() {
    const database = await this.open();
    const transaction = database.transaction(AI_SESSION_STORE_NAME, "readonly");
    const completed = waitForAiSessionTransaction(transaction);
    const records = await waitForAiSessionRequest(transaction.objectStore(AI_SESSION_STORE_NAME).getAll());
    await completed;
    return records.sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
  }

  async replace(records) {
    const database = await this.open();
    const transaction = database.transaction(AI_SESSION_STORE_NAME, "readwrite");
    const completed = waitForAiSessionTransaction(transaction);
    const store = transaction.objectStore(AI_SESSION_STORE_NAME);
    store.clear();
    records.forEach((record) => store.put(record));
    await completed;
  }

  async open() {
    if (!globalThis.indexedDB) throw new Error("IndexedDB is unavailable");
    if (!this.databasePromise) {
      const request = globalThis.indexedDB.open(AI_SESSION_DATABASE_NAME, AI_SESSION_DATABASE_VERSION);
      this.databasePromise = waitForAiSessionRequest(request, (event) => {
        const database = event.target.result;
        if (!database.objectStoreNames.contains(AI_SESSION_STORE_NAME)) {
          const store = database.createObjectStore(AI_SESSION_STORE_NAME, { keyPath: "id" });
          store.createIndex("updatedAt", "updatedAt");
        }
      });
    }
    return this.databasePromise;
  }

  async close() {
    if (!this.databasePromise) return;
    const database = await this.databasePromise;
    database.close();
    this.databasePromise = null;
  }
}

function waitForAiSessionRequest(request, onUpgradeNeeded) {
  return new Promise((resolve, reject) => {
    if (onUpgradeNeeded) request.onupgradeneeded = onUpgradeNeeded;
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
    request.onblocked = () => reject(new Error("IndexedDB request was blocked"));
  });
}

function waitForAiSessionTransaction(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction was aborted"));
  });
}
const AI_COMPLETION_MANUAL_PREFIX_CHARS = 500;
const AI_COMPLETION_MANUAL_SUFFIX_CHARS = 500;
const AI_COMPLETION_MANUAL_MAX_OUTPUT_TOKENS = 512;
const AI_RESPONSE_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];
const AI_IMAGE_MAX_FILE_SIZE = 20 * 1024 * 1024;
const AI_IMAGE_MASK_MAX_FILE_SIZE = 4 * 1024 * 1024;
const AI_IMAGE_OUTPUT_MAX_FILE_SIZE = 25 * 1024 * 1024;
const AI_ATTACHMENT_MAX_COUNT = 10;
const AI_TEXT_ATTACHMENT_MAX_FILE_SIZE = 2 * 1024 * 1024;
const AI_ATTACHMENT_MAX_TOTAL_SIZE = 50 * 1024 * 1024;
const AI_ATTACHMENT_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const PREVIEW_INLINE_IMAGE_MAX_FILE_SIZE = 8 * 1024 * 1024;
const AI_AGENTS_FILE_NAME = "AGENTS.md";
const AI_AGENTS_MAX_CHARS = 30000;
const AI_AGENT_MAX_TOOL_CALL_ROUNDS = 25;
const AI_TOOL_OUTPUT_MIN_CHARS = 1000;
const AI_TOOL_OUTPUT_DEFAULT_MAX_CHARS = 5000;
const AI_TOOL_OUTPUT_HARD_MAX_CHARS = 20000;
const AI_TOOL_SEARCH_LINE_MAX_CHARS = 240;
const AI_JAVASCRIPT_DEFAULT_TIMEOUT_MS = 30_000;
const AI_JAVASCRIPT_MAX_TIMEOUT_MS = 60 * 60 * 1000;
const AI_JAVASCRIPT_MAX_CODE_CHARS = 20_000;
const AI_JAVASCRIPT_MAX_FILE_COUNT = 1000;
const AI_JAVASCRIPT_MAX_LOGS = 100;
const AI_JAVASCRIPT_MAX_REQUEST_COUNT = 100;
const AI_JAVASCRIPT_MAX_PREPARE_REQUEST_COUNT = 200;
const AI_JAVASCRIPT_FAILURE_RECOVERY_HINT = "Inspect the structured error and correct the script, arguments, dependencies, or supported-runtime assumptions before retrying. If the task cannot run in the documented browser runtime, explain the limitation instead of silently changing the execution environment.";
const AI_JAVASCRIPT_MAX_RESULT_COLLECTION_ITEMS = 100;
const AI_JAVASCRIPT_MAX_RESULT_DEPTH = 5;
const SSH_OUTPUT_MAX_CHARS = 120000;
const SSH_COMMAND_OUTPUT_WAIT_MS = 1000;
const SSH_CONNECT_TIMEOUT_MS = 15000;
const WORKSPACE_FILE_ACTION_LIMIT = 1000;
const WORKSPACE_REFERENCE_FILE_LIMIT = 2000;
const WORKSPACE_REFERENCE_RESULT_LIMIT = 1000;
const WORKSPACE_SEARCH_FILE_LIMIT = 3000;
const WORKSPACE_SEARCH_RESULT_LIMIT = 500;
const MONACO_MODEL_SOFT_LIMIT = 150;
let monaco = null;
let monacoLoadPromise = null;
let prettierStandalonePromise = null;
const prettierPluginPromises = new Map();
let xtermBundlePromise = null;
let prepareRunScriptPromise = null;
let aiCompletionRequestSerial = 0;
let aiCompletionInFlight = false;
let aiCompletionAbortController = null;
let monacoLanguageIndex = null;

window.process ||= { env: {} };

const languageOptions = [
  ["plaintext", "Plain Text"], ["javascript", "JavaScript"], ["flow", "Flow"], ["typescript", "TypeScript"], ["html", "HTML"], ["vue", "Vue"], ["angular", "Angular"], ["handlebars", "Handlebars"], ["css", "CSS"], ["scss", "SCSS"], ["less", "Less"], ["json", "JSON"], ["jsonc", "JSONC"], ["json5", "JSON5"], ["markdown", "Markdown"], ["mdx", "MDX"], ["graphql", "GraphQL"], ["yaml", "YAML"], ["python", "Python"], ["go", "Go"], ["rust", "Rust"], ["java", "Java"], ["c", "C"], ["cpp", "C++"], ["csharp", "C#"], ["bat", "Batch"], ["dart", "Dart"], ["fsharp", "F#"], ["ini", "INI"], ["kotlin", "Kotlin"], ["php", "PHP"], ["r", "R"], ["ruby", "Ruby"], ["shell", "Shell"], ["powershell", "PowerShell"], ["sql", "SQL"], ["swift", "Swift"], ["xml", "XML"], ["dockerfile", "Dockerfile"], ["lua", "Lua"],
].map(([id, label]) => ({ id, label, labelKey: id === "plaintext" ? "language.plaintext" : "" }));

const aiReasoningEfforts = ["default", "low", "medium", "high", "xhigh", "max"];
const renderMarkdown = MarkdownUtils.renderMarkdown;
const PREVIEW_FRAME_SANDBOX = "allow-forms allow-modals allow-popups allow-scripts";
const PREVIEW_TYPES = Object.freeze({
  html: Object.freeze({ languages: Object.freeze(["html"]), labelKey: "preview.html" }),
  markdown: Object.freeze({ languages: Object.freeze(["markdown", "mdx"]), labelKey: "preview.markdown" }),
});
const PREVIEW_SOURCE_RENDERERS = Object.freeze({
  html: (content) => String(content || ""),
  markdown: (content, title) => createMarkdownPreviewDocument(renderMarkdown(content), title),
});

function getPreviewType(file) {
  if (!file?.model && typeof file?.content !== "string") return "";
  return Object.entries(PREVIEW_TYPES).find(([, definition]) => definition.languages.includes(file.language))?.[0] || "";
}

function getPreviewTypeDefinition(type) {
  return PREVIEW_TYPES[type] || null;
}

function resolveWorkspacePreviewUrl(url, currentPath) {
  const value = String(url || "").trim();
  if (!value || value.startsWith("#") || value.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(value)) return null;

  const parts = splitPreviewUrlSuffix(value);
  const decodedPath = decodePreviewPath(parts.path);
  if (decodedPath == null) return null;
  const rawPath = decodedPath.replace(/\\/g, "/");
  if (!rawPath) {
    const path = String(currentPath || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    return path ? { path, suffix: parts.suffix, hash: parts.hash } : null;
  }
  const segments = rawPath.startsWith("/") ? [] : getPreviewDirectorySegments(currentPath);
  for (const segment of rawPath.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!segments.length) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  if (!segments.length) return null;
  return { path: segments.join("/"), suffix: parts.suffix, hash: parts.hash };
}

function splitPreviewUrlSuffix(url) {
  const value = String(url || "");
  const hashIndex = value.indexOf("#");
  const queryIndex = value.indexOf("?");
  const indexes = [hashIndex, queryIndex].filter((index) => index >= 0);
  if (!indexes.length) return { path: value, suffix: "", hash: "" };
  const splitIndex = Math.min(...indexes);
  return { path: value.slice(0, splitIndex), suffix: value.slice(splitIndex), hash: hashIndex >= 0 ? value.slice(hashIndex) : "" };
}

function getPreviewDirectorySegments(path) {
  const normalized = String(path || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized) return [];
  const segments = normalized.split("/");
  segments.pop();
  return segments;
}

function decodePreviewPath(path) {
  try {
    return decodeURIComponent(String(path || ""));
  } catch {
    return null;
  }
}

const sshTerminalThemes = {
  dark: { background: "#1e1e1e", foreground: "#cccccc", cursor: "#ffffff", selectionBackground: "#264f78" },
  light: { background: "#ffffff", foreground: "#1f1f1f", cursor: "#1f1f1f", selectionBackground: "#add6ff" },
  solarizedDark: { background: "#002b36", foreground: "#839496", cursor: "#93a1a1", selectionBackground: "#073642" },
  monokai: { background: "#272822", foreground: "#f8f8f2", cursor: "#f8f8f0", selectionBackground: "#49483e" },
};

const sshTerminalThemeOptions = [
  { value: "dark", labelKey: "terminalTheme.dark" },
  { value: "light", labelKey: "terminalTheme.light" },
  { value: "solarizedDark", labelKey: "terminalTheme.solarizedDark" },
  { value: "monokai", labelKey: "terminalTheme.monokai" },
];

const shortcutItems = [
  { key: "save", labelKey: "shortcut.save" },
  { key: "format", labelKey: "shortcut.format" },
  { key: "commandPalette", labelKey: "shortcut.commandPalette" },
  { key: "search", labelKey: "shortcut.search" },
  { key: "findReferences", labelKey: "shortcut.findReferences" },
  { key: "preview", labelKey: "shortcut.preview" },
  { key: "toggleSidebar", labelKey: "shortcut.toggleSidebar" },
  { key: "fold", labelKey: "shortcut.fold" },
  { key: "unfold", labelKey: "shortcut.unfold" },
  { key: "foldAll", labelKey: "shortcut.foldAll" },
  { key: "unfoldAll", labelKey: "shortcut.unfoldAll" },
  { key: "aiComplete", labelKey: "shortcut.aiComplete" },
];

const TreeList = defineComponent({
  name: "TreeList",
  props: { nodes: Array, depth: Number, activePath: String, collapsedPaths: Object, dirtyPaths: Object },
  emits: ["open-file", "toggle-dir", "context-node"],
  setup(props, { emit }) {
    return () => h("ul", { class: "tree-list" }, props.nodes.map((node) => {
      const collapsed = node.kind === "directory" && props.collapsedPaths.has(node.path);
      const row = h("button", {
        class: ["tree-row", { active: node.path === props.activePath }],
        style: { paddingLeft: `${8 + props.depth * 14}px` },
        title: node.path,
        "aria-expanded": node.kind === "directory" ? String(!collapsed) : "false",
        onClick: () => node.kind === "directory" ? emit("toggle-dir", node.path) : emit("open-file", node),
        onContextmenu: (event) => { event.preventDefault(); event.stopPropagation(); emit("context-node", event, node); },
      }, [
        h("span", { class: ["chevron", "codicon", node.kind === "directory" ? (collapsed ? "codicon-chevron-right" : "codicon-chevron-down") : ""] }),
        h("span", { class: ["icon", "codicon", getTreeIconClass(node, collapsed)] }),
        h("span", { class: "name" }, node.name),
        isDirtyTreeNode(node, props.dirtyPaths) ? h("span", { class: "tree-dirty" }, "•") : null,
      ]);
      return h("li", { key: node.path }, [row, node.kind === "directory" && node.children.length && !collapsed ? h(TreeList, { nodes: node.children, depth: props.depth + 1, activePath: props.activePath, collapsedPaths: props.collapsedPaths, dirtyPaths: props.dirtyPaths, onOpenFile: (file) => emit("open-file", file), onToggleDir: (path) => emit("toggle-dir", path), onContextNode: (event, item) => emit("context-node", event, item) }) : null]);
    }));
  },
});

function isDirtyTreeNode(node, dirtyPaths) {
  if (!dirtyPaths) return false;
  if (node.kind === "file") return dirtyPaths.has(node.path);
  return Array.from(dirtyPaths).some((path) => path.startsWith(`${node.path}/`));
}

const editorHost = ref(null);
const diffHost = ref(null);
const previewFrame = ref(null);
const aiMessagesEl = ref(null);
const sshTerminalHost = ref(null);
const editor = shallowRef(null);
const diffEditor = shallowRef(null);
const rootHandle = shallowRef(null);
const fileSession = shallowRef(null);
let workspaceGeneration = 0;
let refreshTreeSerial = 0;
const rootName = ref("");
const rootKind = ref("");
const diskTree = shallowRef([]);
const collapsedPaths = reactive(new Set());
const openFiles = reactive(new Map());
const externalWritePaths = new Map();
const pendingFileLoads = new Set();
const selectedChangePaths = reactive(new Set());
const activePath = ref("");
const activeDiffPath = ref("");
const previewOpenPaths = reactive(new Set());
const previewVisible = ref(false);
const previewContent = ref("");
const previewPageUrl = ref("");
const previewFrameKey = ref(0);
const previewOwnerPath = ref("");
const previewPath = ref("");
const previewUrlSuffix = ref("");
const previewType = ref("");
const dirtyRevision = ref(0);
const activeView = ref("explorer");
const sidePanelVisible = ref(true);
const sidebarResizing = ref(false);
const previewResizing = ref(false);
const sidebarWidth = ref(DEFAULT_SIDEBAR_WIDTH);
const previewWidth = ref(DEFAULT_PREVIEW_WIDTH);
const keybindingDisposables = [];
const inlineCompletionDisposables = [];
const referenceProviderDisposables = [];
const workspaceFileActionDisposables = [];
let workspaceFileActionKey = "";
let editorOpenerDisposable = null;
const workspaceModelPaths = new Set();
const status = reactive({ left: tr("status.ready"), right: tr("status.loaded") });
const contextMenu = reactive({ visible: false, x: 0, y: 0, node: null });
const changesContextMenu = reactive({ visible: false, x: 0, y: 0, file: null });
const dialogInput = ref(null);
const dialogSelect = ref(null);
const dialogOptionInput = ref(null);
const dialogPrimaryButton = ref(null);
const dialogState = reactive({ visible: false, mode: "alert", title: "", message: "", value: "", inputLabel: "", placeholder: "", selectOptions: [], optionLabel: "", optionHint: "", optionChecked: false, optionDisabled: false, confirmLabel: "", cancelLabel: "", tone: "default", selectOnFocus: false, closeOnBackdrop: true });
const settings = reactive(loadSettings());
settings.locale = getCurrentLocale();
const maxMemoryReadMb = computed({
  get: () => bytesToMegabytes(settings.maxMemoryReadBytes),
  set: (value) => { settings.maxMemoryReadBytes = megabytesToBytes(value, DEFAULT_MAX_MEMORY_READ_BYTES); },
});
const maxMemoryWriteMb = computed({
  get: () => bytesToMegabytes(settings.maxMemoryWriteBytes),
  set: (value) => { settings.maxMemoryWriteBytes = megabytesToBytes(value, DEFAULT_MAX_MEMORY_WRITE_BYTES); },
});
const sshSessions = reactive(new Map());
const activeSshTerminalId = ref("");
const sshRevision = ref(0);
const sshDialog = reactive({ visible: false, mode: "create", draft: createSshDraft() });
const sftpDialog = reactive({ visible: false, mode: "upload", connectionId: "", connectionName: "", localPath: "", remotePath: "", useUnsaved: true });
const sftpTasks = reactive([]);
const sftpTasksCollapsed = ref(true);
const aiCredentialStore = markRaw(new AiCredentialStore());
const aiSessionStore = markRaw(new AiSessionStore());
let disableEditorPwa = null;
let aiSessionSerial = 0;
const aiSessions = reactive([]);
const aiSessionDraft = reactive(createAiSessionDraft());
const activeAiSessionId = ref("");
const activeAiSession = computed(() => aiSessions.find((session) => session.id === activeAiSessionId.value) || null);
const aiMessages = computed(() => activeAiSession.value?.messages || []);
const aiAttachments = computed(() => activeAiSession.value?.pendingAttachments || aiSessionDraft.pendingAttachments);
const aiSessionTitleInput = ref(null);
const aiAttachmentInput = ref(null);
const aiHistorySearchInput = ref(null);
const aiSessionTitleEditing = ref(false);
const aiSessionMenuVisible = ref(false);
const aiHistoryVisible = ref(false);
const aiHistoryQuery = ref("");
const aiSessionFingerprints = new Map();
let aiSessionsReady = false;
let updatingAiSessionTimestamps = false;
let aiSessionPersistTask = Promise.resolve();
let aiMessagesFollowOutput = true;
const aiPrompt = computed({
  get: () => activeAiSession.value?.prompt ?? aiSessionDraft.prompt,
  set: (value) => {
    if (activeAiSession.value) activeAiSession.value.prompt = value;
    else aiSessionDraft.prompt = value;
  },
});
const aiSessionAgentModel = computed({
  get: () => activeAiSession.value?.agentModel ?? aiSessionDraft.agentModel,
  set: (value) => {
    if (activeAiSession.value) activeAiSession.value.agentModel = String(value || "").trim();
    else aiSessionDraft.agentModel = String(value || "").trim();
  },
});
const aiSessionReasoningEffort = computed({
  get: () => activeAiSession.value?.reasoningEffort ?? aiSessionDraft.reasoningEffort,
  set: (value) => {
    const reasoningEffort = aiReasoningEfforts.includes(value) ? value : defaultAiSettings.reasoningEffort;
    if (activeAiSession.value) activeAiSession.value.reasoningEffort = reasoningEffort;
    else aiSessionDraft.reasoningEffort = reasoningEffort;
  },
});
const aiSessionTitle = computed({
  get: () => activeAiSession.value?.title ?? aiSessionDraft.title,
  set: (value) => {
    if (activeAiSession.value) activeAiSession.value.title = String(value || "");
    else aiSessionDraft.title = String(value || "");
  },
});
const aiSessionSaved = computed({
  get: () => Boolean(activeAiSession.value?.saved ?? aiSessionDraft.saved),
  set: (value) => {
    if (activeAiSession.value) activeAiSession.value.saved = Boolean(value);
    else aiSessionDraft.saved = Boolean(value);
  },
});
const aiBusy = computed(() => Boolean(activeAiSession.value?.busy || activeAiSession.value?.titleBusy));
const aiAvailableModels = ref([]);
const aiModelsLoading = ref(false);
const agentsMdContent = ref("");
const agentModelToAdd = ref("");
const searchQuery = ref("");
const searchReplaceText = ref("");
const searchMatchCase = ref(false);
const searchResults = ref([]);
const searchBusy = ref(false);
const searchSearched = ref(false);
let searchSerial = 0;
const aiAgentModelOptions = computed(() => uniqueStrings([...getAgentModels(), ...aiSessions.map((session) => session.agentModel)]));
const aiModelOptions = computed(() => uniqueStrings([settings.ai.completionModel, settings.ai.imageModel, ...aiAgentModelOptions.value, defaultAiSettings.completionModel, defaultAiSettings.imageModel, ...aiAvailableModels.value]));
const aiContextLength = computed(() => formatAiUsage(activeAiSession.value?.contextUsage));
const canResetAiConversation = computed(() => Boolean(aiPrompt.value.trim() || aiMessages.value.length || (activeAiSession.value && getAiTouchedFiles(activeAiSession.value).length)));
const aiHistoryGroups = computed(() => groupAiSessionDrawerItems(aiSessions
  .filter((session) => matchesAiHistoryQuery(session, aiHistoryQuery.value))
  .sort((left, right) => right.updatedAt - left.updatedAt)));
const tree = computed(() => {
  dirtyRevision.value;
  return mergePendingFilesIntoTree(diskTree.value, Array.from(openFiles.values()).filter((file) => file.isNew || file.deleted));
});

const openFileList = computed(() => {
  dirtyRevision.value;
  return Array.from(openFiles.values()).filter((file) => !file.closed);
});
const dirtyFiles = computed(() => {
  dirtyRevision.value;
  return Array.from(openFiles.values()).filter((file) => file.dirty);
});
const selectedChangeFiles = computed(() => {
  dirtyRevision.value;
  return dirtyFiles.value.filter((file) => selectedChangePaths.has(file.path));
});
const allChangesSelected = computed(() => dirtyFiles.value.length > 0 && dirtyFiles.value.every((file) => selectedChangePaths.has(file.path)));
const dirtyPathSet = computed(() => {
  dirtyRevision.value;
  return new Set(dirtyFiles.value.map((file) => file.path));
});
const activeFile = computed(() => {
  dirtyRevision.value;
  return openFiles.get(activePath.value);
});
const activeTextFile = computed(() => isTextFileState(activeFile.value) ? activeFile.value : null);
const activeImageFile = computed(() => activeFile.value?.fileType === "image" ? activeFile.value : null);
const activeUnsupportedFile = computed(() => activeFile.value?.fileType === "unsupported" ? activeFile.value : null);
const activeDiffFile = computed(() => {
  dirtyRevision.value;
  return activeDiffPath.value ? openFiles.get(activeDiffPath.value) : null;
});
const activeDiffImageFile = computed(() => activeDiffFile.value?.fileType === "image" && !activeDiffFile.value.deleted ? activeDiffFile.value : null);
const activeDiffUnsupportedFile = computed(() => {
  const file = activeDiffFile.value;
  return file && !isTextFileState(file) && (file.fileType === "unsupported" || file.deleted) ? file : null;
});
const displayedImageFile = computed(() => activeDiffImageFile.value || (!activeDiffPath.value ? activeImageFile.value : null));
const activeLanguage = computed({ get: () => activeFile.value?.language || "plaintext", set: (value) => { if (activeFile.value) activeFile.value.language = value; } });
const activePreviewType = computed(() => getPreviewType(activeTextFile.value));
const canPreviewActiveFile = computed(() => Boolean(activePreviewType.value));
const previewLabelKey = computed(() => getPreviewTypeDefinition(previewType.value)?.labelKey || "action.preview");
const activeFilePreviewVisible = computed(() => Boolean(activePath.value && previewOpenPaths.has(activePath.value)));
const previewPaneVisible = computed(() => Boolean(activeFilePreviewVisible.value && previewVisible.value && previewOwnerPath.value === activePath.value && previewPath.value && previewType.value && !activeSshTerminal.value));
const sshFeatureEnabled = computed(() => isBackendEnabled());
const sshTerminalTabs = computed(() => {
  sshRevision.value;
  return Array.from(sshSessions.values()).filter((session) => session.tabOpen);
});
const activeSshTerminal = computed(() => {
  sshRevision.value;
  return activeSshTerminalId.value ? sshSessions.get(activeSshTerminalId.value) || null : null;
});
const dialogIconClass = computed(() => {
  if (isPromptDialogMode(dialogState.mode)) return "codicon-edit";
  if (dialogState.mode.startsWith("confirm")) return dialogState.tone === "danger" ? "codicon-warning" : "codicon-question";
  return dialogState.tone === "danger" ? "codicon-error" : "codicon-info";
});

watch(currentLocale, (locale, previousLocale) => {
  const previousMessages = codeEditorMessages[previousLocale]?.codeEditor || {};
  if (status.left === previousMessages["status.ready"] && status.right === previousMessages["status.loaded"]) {
    setStatus(tr("status.ready"), tr("status.loaded"));
  }
  settings.locale = locale;
  document.documentElement.lang = locale;
  if (monaco) registerKeybindings();
});
watch(() => aiMessages.value.length, () => { nextTick(scrollAiMessagesToBottom); });
watch(activeSshTerminalId, () => { nextTick(attachActiveSshTerminal); });
watch(activeAiSessionId, () => {
  aiSessionTitleEditing.value = false;
  aiSessionMenuVisible.value = false;
  nextTick(() => scrollAiMessagesToBottom(true));
});
watch(aiSessions, handleAiSessionsChanged, { deep: true, flush: "sync" });
watch(searchMatchCase, () => { if (searchSearched.value && searchQuery.value.trim()) runGlobalSearch(); });
watch(() => dirtyFiles.value.map((file) => file.path).join("\0"), pruneSelectedChangePaths);
watch(previewPaneVisible, () => { nextTick(layoutVisibleEditors); });
watch([previewPaneVisible, previewPath, previewUrlSuffix, dirtyRevision, currentLocale], () => { void updatePreviewContent(); });
watch(settings, () => {
  syncFileOperationPolicy();
  persistSettings();
}, { deep: true });
persistSettings();

onMounted(async () => {
  document.documentElement.lang = getCurrentLocale();
  const pageTitle = document.title;
  const pageDescription = document.querySelector('meta[name="description"]')?.content || pageTitle;
  disableEditorPwa = enableEditorPwa({
    name: pageTitle,
    shortName: pageTitle,
    description: pageDescription,
    startUrl: CODE_EDITOR_PWA_PATH,
    scope: CODE_EDITOR_PWA_PATH,
    icon: "/pwa-code-editor-icon.svg",
    meta: {
      "theme-color": "#0f172a",
      "mobile-web-app-capable": "yes",
      "apple-mobile-web-app-capable": "yes",
      "apple-mobile-web-app-title": pageTitle,
      "apple-mobile-web-app-status-bar-style": "black-translucent"
    }
  });
  applyChromeTheme();
  await promptImportSettingsFromUrl();
  await restoreSavedAiSessions();
  monaco = await loadMonaco();
  registerFormatters();
  editor.value = markRaw(monaco.editor.create(editorHost.value, {
    automaticLayout: true,
    fontFamily: "Consolas, 'Courier New', monospace",
    fontLigatures: true,
    lineNumbersMinChars: 4,
    roundedSelection: false,
    scrollBeyondLastLine: false,
    contextmenu: true,
    smoothScrolling: true,
    tabSize: 2,
    theme: settings.theme,
    fontSize: settings.fontSize,
    wordWrap: settings.wordWrap ? "on" : "off",
    minimap: { enabled: settings.minimap },
    inlineSuggest: { enabled: true, mode: "prefix", suppressSuggestions: false },
  }));
  diffEditor.value = markRaw(monaco.editor.createDiffEditor(diffHost.value, {
    automaticLayout: true,
    originalEditable: false,
    readOnly: false,
    renderSideBySide: true,
    theme: settings.theme,
    fontSize: settings.fontSize,
    wordWrap: settings.wordWrap ? "on" : "off",
    minimap: { enabled: settings.minimap },
  }));
  registerKeybindings();
  registerInlineCompletions();
  registerReferenceProviders();
  registerWorkspaceEditorOpener();
  registerCompletionInvalidation();
  setStatus(tr("status.ready"), tr("status.loaded"));
  document.addEventListener("click", hideAllContextMenus);
  document.addEventListener("keydown", handleGlobalCommandPaletteShortcut);
  window.addEventListener("resize", hideAllContextMenus);
  window.addEventListener("resize", scheduleActiveSshTerminalFit);
  window.addEventListener("beforeunload", beforeUnload);
  window.addEventListener("pagehide", handlePageHide);
  window.addEventListener("message", handlePreviewWindowMessage);
});

onBeforeUnmount(() => {
  disableEditorPwa?.();
  formatterDisposables.splice(0).forEach((disposable) => disposable.dispose());
  workspaceFileActionDisposables.splice(0).forEach((disposable) => disposable.dispose());
  editorOpenerDisposable?.dispose();
  editorOpenerDisposable = null;
  referenceProviderDisposables.splice(0).forEach((disposable) => disposable.dispose());
  keybindingDisposables.splice(0).forEach((disposable) => disposable.dispose());
  inlineCompletionDisposables.splice(0).forEach((disposable) => disposable.dispose());
  abortAiCompletionRequest();
  cancelRunningSftpTasks();
  queuePersistSavedAiSessions();
  aiSessions.forEach((session) => session.abortController?.abort());
  aiSessions.forEach((session) => session.titleAbortController?.abort());
  void aiSessionPersistTask.then(() => aiSessionStore.close()).catch((error) => console.warn("Failed to close AI session storage", error));
  aiSessions.forEach((session) => disposeAiMessageResources(session.messages));
  closeAllSshSessions({ disposeTerminal: true });
  diffEditor.value?.setModel(null);
  editor.value?.setModel(null);
  openFiles.forEach((file) => disposeFileModels(file, { force: true }));
  disposeWorkspaceModels({ force: true });
  previewBroadcastChannel?.close();
  previewBroadcastChannel = null;
  revokePreviewPageUrl();
  revokePreviewResourceUrls();
  editor.value?.dispose();
  diffEditor.value?.dispose();
  document.removeEventListener("click", hideAllContextMenus);
  document.removeEventListener("keydown", handleGlobalCommandPaletteShortcut);
  window.removeEventListener("resize", hideAllContextMenus);
  window.removeEventListener("resize", scheduleActiveSshTerminalFit);
  window.removeEventListener("beforeunload", beforeUnload);
  window.removeEventListener("pagehide", handlePageHide);
  window.removeEventListener("message", handlePreviewWindowMessage);
});

function tr(key, params = {}) {
  return t(`codeEditor.${key}`, params);
}

function getCurrentLocale() {
  return currentLocale.value || currentLocale || defaultSettings.locale;
}

function togglePreview() {
  if (activeFilePreviewVisible.value) {
    closePreview();
  } else {
    openPreview();
  }
}

function openPreview() {
  const file = activeTextFile.value;
  const type = getPreviewType(file);
  if (!file || !type) return;
  previewOpenPaths.add(file.path);
  previewOwnerPath.value = file.path;
  previewPath.value = file.path;
  previewUrlSuffix.value = "";
  previewType.value = type;
  previewVisible.value = true;
  void nextTick(() => updatePreviewContent({ remountFrame: true }));
}

function closePreview(path = activePath.value || previewOwnerPath.value) {
  if (path) previewOpenPaths.delete(path);
  if (previewOwnerPath.value !== path) return;
  previewRenderSerial += 1;
  previewVisible.value = false;
  previewOwnerPath.value = "";
  if (standalonePreviewClients.size) return;
  clearPreviewContent();
}

function clearPreviewContent() {
  previewContent.value = "";
  lastPreviewUpdate = null;
  revokePreviewPageUrl();
  replacePreviewResourceUrls(new Map());
}

function resetPreviewState() {
  previewRenderSerial += 1;
  previewNavigationSerial += 1;
  previewOpenPaths.clear();
  previewVisible.value = false;
  previewOwnerPath.value = "";
  previewPath.value = "";
  previewUrlSuffix.value = "";
  previewType.value = "";
  previewBroadcastChannel?.postMessage({ type: "preview:update", content: "", title: tr("action.preview"), path: "", suffix: "", previewType: "", revision: ++previewUpdateRevision });
  clearPreviewContent();
}

function layoutVisibleEditors() {
  editor.value?.layout();
  diffEditor.value?.layout();
}

let previewRenderSerial = 0;
let previewResourceObjectUrls = new Map();
let previewPageObjectUrl = "";
const previewBroadcastChannelName = `code-editor-preview-${crypto.randomUUID()}`;
const standalonePreviewClients = new Set();
let previewBroadcastChannel = null;
let lastPreviewUpdate = null;
let previewNavigationSerial = 0;
let previewUpdateRevision = 0;

async function updatePreviewContent({ remountFrame = false } = {}) {
  const serial = ++previewRenderSerial;
  const path = previewPath.value;
  const suffix = previewUrlSuffix.value;
  if (!previewPaneVisible.value && !standalonePreviewClients.size) return;
  if (!path) return;

  const objectUrls = new Map();
  let file;
  let type;
  let resolved;
  try {
    file = await readPreviewFile(path);
    type = getPreviewType(file);
    if (!type) throw new Error(`File is not previewable: ${path}`);
    const title = file.name || tr("action.preview");
    const sourceDocument = createPreviewSourceDocument(getPreviewFileContent(file), title, type);
    resolved = await rewritePreviewDocument(sourceDocument, file, objectUrls, suffix);
  } catch (error) {
    revokeObjectUrlMap(objectUrls);
    if (serial === previewRenderSerial) reportError("error.openFile", error);
    return;
  }
  if (serial !== previewRenderSerial) {
    revokeObjectUrlMap(objectUrls);
    return;
  }
  previewType.value = type;
  previewContent.value = resolved;
  const title = file.name || tr("action.preview");
  const update = { type: "preview:update", content: resolved, title, path, suffix, previewType: type, revision: ++previewUpdateRevision };
  replacePreviewPageUrl(createPreviewPageUrl(update));
  broadcastPreviewUpdate(update);
  if (remountFrame) previewFrameKey.value += 1;
  replacePreviewResourceUrls(objectUrls);
}

function createPreviewSourceDocument(source, title, type) {
  const renderer = PREVIEW_SOURCE_RENDERERS[type];
  if (!renderer) throw new Error(`Unsupported preview type: ${type}`);
  return renderer(source, title);
}

function createPreviewPageUrl(initialUpdate) {
  const frameContent = initialUpdate.content;
  const title = initialUpdate.title;
  const documentContent = `<!doctype html>
<html lang="${escapePreviewAttribute(getCurrentLocale())}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapePreviewHtml(title)}</title>
  <style>html,body,iframe{width:100%;height:100%;margin:0;border:0}body{overflow:hidden;background:#fff}iframe{display:block}</style>
</head>
<body>
  <iframe title="${escapePreviewAttribute(title)}" sandbox="${PREVIEW_FRAME_SANDBOX}" srcdoc="${escapePreviewAttribute(frameContent)}"></iframe>
  <script>
    (() => {
      const frame = document.querySelector("iframe");
      if (!("BroadcastChannel" in window)) return;
      const channel = new BroadcastChannel(${JSON.stringify(previewBroadcastChannelName)});
      const clientId = crypto.randomUUID();
      let revision = ${Number(initialUpdate.revision) || 0};
      channel.addEventListener("message", (event) => {
        const update = event.data;
        if (!update || update.type !== "preview:update" || typeof update.content !== "string") return;
        if (update.targetClientId && update.targetClientId !== clientId) return;
        if (Number(update.revision) <= revision) return;
        revision = Number(update.revision) || revision;
        const title = typeof update.title === "string" ? update.title : document.title;
        document.title = title;
        frame.title = title;
        frame.srcdoc = update.content;
      });
      window.addEventListener("message", (event) => {
        const message = event.data;
        if (event.source !== frame.contentWindow || message?.type !== "code-editor-preview:navigate") return;
        channel.postMessage({ ...message, type: "preview:navigate", clientId });
      });
      channel.postMessage({ type: "preview:subscribe", clientId });
      window.addEventListener("pagehide", () => {
        channel.postMessage({ type: "preview:unsubscribe", clientId });
        channel.close();
      }, { once: true });
    })();
  ${"</scr" + "ipt>"}
</body>
</html>`;
  return URL.createObjectURL(new Blob([documentContent], { type: "text/html;charset=utf-8" }));
}

function broadcastPreviewUpdate(update, targetClientId = "") {
  if (!targetClientId) lastPreviewUpdate = { ...update };
  getPreviewBroadcastChannel()?.postMessage(targetClientId ? { ...update, targetClientId } : update);
}

function getPreviewBroadcastChannel() {
  if (!("BroadcastChannel" in window)) return null;
  if (previewBroadcastChannel) return previewBroadcastChannel;
  previewBroadcastChannel = new BroadcastChannel(previewBroadcastChannelName);
  previewBroadcastChannel.addEventListener("message", handlePreviewBroadcastMessage);
  return previewBroadcastChannel;
}

function handlePreviewBroadcastMessage(event) {
  const message = event.data;
  if (!message?.clientId) return;
  if (message.type === "preview:subscribe") {
    standalonePreviewClients.add(message.clientId);
    if (lastPreviewUpdate) broadcastPreviewUpdate(lastPreviewUpdate, message.clientId);
    return;
  }
  if (message.type === "preview:navigate") {
    void navigatePreviewDocument(message.path, message.suffix);
    return;
  }
  if (message.type !== "preview:unsubscribe") return;
  standalonePreviewClients.delete(message.clientId);
  if (!previewPaneVisible.value && !standalonePreviewClients.size) clearPreviewContent();
}

function handlePreviewWindowMessage(event) {
  const message = event.data;
  if (event.source !== previewFrame.value?.contentWindow || message?.type !== "code-editor-preview:navigate") return;
  void navigatePreviewDocument(message.path, message.suffix);
}

async function navigatePreviewDocument(path, suffix = "") {
  const serial = ++previewNavigationSerial;
  const workspace = rootHandle.value;
  let normalized;
  try {
    normalized = normalizePreviewFilePath(path);
    const file = await readPreviewFile(normalized);
    if (serial !== previewNavigationSerial || workspace !== rootHandle.value) return;
    const type = getPreviewType(file);
    if (!type) throw new Error(`File is not previewable: ${normalized}`);
    const normalizedSuffix = /^[?#]/.test(String(suffix || "")) ? String(suffix) : "";
    const unchanged = previewPath.value === normalized && previewUrlSuffix.value === normalizedSuffix && previewType.value === type;
    previewPath.value = normalized;
    previewUrlSuffix.value = normalizedSuffix;
    previewType.value = type;
    if (unchanged) void updatePreviewContent({ remountFrame: true });
  } catch (error) {
    if (serial === previewNavigationSerial && workspace === rootHandle.value) reportError("error.openFile", error);
  }
}

function createMarkdownPreviewDocument(content, title) {
  return `<!doctype html>
<html lang="${escapePreviewAttribute(getCurrentLocale())}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapePreviewHtml(title)}</title>
  <style>
    :root{color-scheme:light dark;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.6}
    body{max-width:960px;margin:0 auto;padding:32px;color:CanvasText;background:Canvas;overflow-wrap:anywhere}
    img,video{max-width:100%;height:auto}pre{overflow:auto;padding:16px;border-radius:6px;background:color-mix(in srgb,CanvasText 8%,Canvas)}
    code{font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace}blockquote{margin-left:0;padding-left:16px;border-left:4px solid color-mix(in srgb,CanvasText 24%,Canvas)}
    table{border-collapse:collapse}th,td{padding:6px 12px;border:1px solid color-mix(in srgb,CanvasText 24%,Canvas)}a{color:LinkText}
    @media(max-width:640px){body{padding:20px}}
  </style>
</head>
<body>${content}</body>
</html>`;
}

function escapePreviewHtml(value) {
  return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapePreviewAttribute(value) {
  return escapePreviewHtml(value).replaceAll('"', "&quot;");
}

function replacePreviewPageUrl(nextUrl) {
  const previousUrl = previewPageObjectUrl;
  previewPageObjectUrl = nextUrl;
  previewPageUrl.value = nextUrl;
  if (previousUrl) URL.revokeObjectURL(previousUrl);
}

function revokePreviewPageUrl() {
  replacePreviewPageUrl("");
}

async function rewritePreviewDocument(html, file, objectUrls, suffix) {
  const documentNode = new DOMParser().parseFromString(String(html || ""), "text/html");
  const elements = Array.from(documentNode.querySelectorAll("[src], [href]"));
  for (const element of elements) {
    if (element.hasAttribute("src")) {
      element.setAttribute("src", await getPreviewResourceUrl(element.getAttribute("src"), file, objectUrls));
    }
    if (!element.hasAttribute("href")) continue;
    if (element.tagName.toLowerCase() === "a") {
      await rewritePreviewAnchor(element, file, objectUrls);
    } else {
      element.setAttribute("href", await getPreviewResourceUrl(element.getAttribute("href"), file, objectUrls));
    }
  }
  installPreviewNavigationBridge(documentNode, suffix);
  return `<!doctype html>\n${documentNode.documentElement.outerHTML}`;
}

async function rewritePreviewAnchor(anchor, file, objectUrls) {
  const href = anchor.getAttribute("href") || "";
  const resolved = resolveWorkspacePreviewUrl(href, file.path);
  if (!resolved) return;
  try {
    const target = await readPreviewFile(resolved.path);
    if (getPreviewType(target)) {
      anchor.dataset.previewPath = resolved.path;
      anchor.dataset.previewSuffix = resolved.suffix;
      anchor.removeAttribute("target");
      return;
    }
  } catch {
    return;
  }
  anchor.setAttribute("href", await getPreviewResourceUrl(href, file, objectUrls));
}

function installPreviewNavigationBridge(documentNode, suffix) {
  const script = documentNode.createElement("script");
  const initialHash = getPreviewHash(suffix);
  script.dataset.previewBridge = "";
  script.textContent = `(() => {
    const initialHash = ${serializePreviewScriptValue(initialHash)};
    document.addEventListener("click", (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : event.target?.parentElement;
      const anchor = target?.closest("a[data-preview-path]");
      if (!anchor || anchor.hasAttribute("download")) return;
      event.preventDefault();
      window.parent.postMessage({
        type: "code-editor-preview:navigate",
        path: anchor.dataset.previewPath || "",
        suffix: anchor.dataset.previewSuffix || ""
      }, "*");
    }, true);
    const scrollToInitialHash = () => {
      if (!initialHash) return;
      let name = initialHash.slice(1);
      try { name = decodeURIComponent(name); } catch {}
      const target = document.getElementById(name) || document.getElementsByName(name)[0];
      target?.scrollIntoView();
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scrollToInitialHash, { once: true });
    else scrollToInitialHash();
  })();`;
  documentNode.head.prepend(script);
}

function serializePreviewScriptValue(value) {
  return JSON.stringify(String(value || "")).replaceAll("<", "\\u003c");
}

function getPreviewHash(suffix) {
  const value = String(suffix || "");
  const index = value.indexOf("#");
  return index >= 0 ? value.slice(index) : "";
}

async function getPreviewResourceUrl(value, file, objectUrls) {
  const url = String(value || "").trim();
  const resolved = resolveWorkspacePreviewUrl(url, file.path);
  if (!resolved) return value;
  let resource;
  try {
    resource = await readPreviewFile(resolved.path);
  } catch {
    return value;
  }
  if (resource.fileType === "text") return `${getTextDataUrl(resource)}${resolved.hash}`;
  if (resource.fileType === "image") {
    const dataUrl = await getPreviewImageDataUrl(resource);
    return dataUrl ? `${dataUrl}${resolved.hash}` : value;
  }
  if (resource.persisted || resource.isNew) return `${await getPreviewBlobUrl(resource, objectUrls)}${resolved.hash}`;
  return value;
}

async function readPreviewFile(path) {
  const normalized = normalizePreviewFilePath(path);
  const existing = openFiles.get(normalized);
  if (existing) {
    if (existing.deleted) throw new Error(`File not found: ${normalized}`);
    assertOpenFileMemoryRead(existing);
    return existing;
  }
  const node = findNodeByPath(tree.value, normalized);
  if (!node || node.kind !== "file") throw new Error(`File not found: ${normalized}`);
  if (isImageEntry(node)) return { ...node, fileType: "image", persisted: true };
  if (!isReadableTextEntry(node)) return { ...node, fileType: "unsupported", persisted: true };
  return { ...node, fileType: "text", language: getLanguageId(node.name), content: await fileSession.value.readText(node.path), persisted: true };
}

function normalizePreviewFilePath(path) {
  const normalized = String(path || "").replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
  if (!normalized || normalized.split("/").some((part) => !part || part === "." || part === "..")) throw new Error(tr("error.invalidPath"));
  return normalized;
}

function getPreviewFileContent(file) {
  return file.model?.getValue() ?? String(file.content || "");
}

async function getPreviewBlobUrl(file, objectUrls) {
  if (objectUrls.has(file.path)) return objectUrls.get(file.path);
  const source = getActiveBlobFile(file);
  if (source) fileSession.value.fileSystem.policy.assertMemoryRead(file.path, source.size);
  const blob = source || await fileSession.value.readBlob(file.path);
  const objectUrl = URL.createObjectURL(blob);
  objectUrls.set(file.path, objectUrl);
  return objectUrl;
}

function replacePreviewResourceUrls(nextUrls) {
  const previousUrls = previewResourceObjectUrls;
  previewResourceObjectUrls = nextUrls;
  revokeObjectUrlMap(previousUrls);
}

function revokePreviewResourceUrls() {
  replacePreviewResourceUrls(new Map());
}

function revokeObjectUrlMap(urls) {
  urls.forEach((url) => URL.revokeObjectURL(url));
  urls.clear();
}

function getTextDataUrl(file) {
  const mimeType = getPreviewMimeType(file);
  return `data:${mimeType};charset=utf-8,${encodeURIComponent(getPreviewFileContent(file))}`;
}

async function getPreviewImageDataUrl(file) {
  const blob = getActiveImageBlob(file) || await fileSession.value.readBlob(file.path);
  const maxSize = Math.min(PREVIEW_INLINE_IMAGE_MAX_FILE_SIZE, fileSession.value.fileSystem.policy.maxMemoryReadBytes);
  if (blob.size > maxSize) return "";
  return FileUtils.normalizeImageDataUrl(await FileUtils.readFileAsDataUrl(blob), FileUtils.getImageMimeType(file.name, blob.type));
}

function getPreviewMimeType(file) {
  const byLanguage = { css: "text/css", javascript: "text/javascript", typescript: "text/typescript", html: "text/html", markdown: "text/markdown", json: "application/json", svg: "image/svg+xml", xml: "application/xml" };
  return byLanguage[file.language] || "text/plain";
}

const dialogQueue = [];
let activeDialogResolve = null;

function showAlert(message, options = {}) {
  return showDialog({ mode: "alert", message, title: options.title || tr("dialog.alertTitle"), tone: options.tone, confirmLabel: options.confirmLabel || tr("dialog.ok"), closeOnBackdrop: options.closeOnBackdrop });
}

function showConfirm(message, options = {}) {
  return showDialog({ mode: "confirm", message, title: options.title || tr("dialog.confirmTitle"), tone: options.tone, confirmLabel: options.confirmLabel || tr("dialog.ok"), cancelLabel: options.cancelLabel || tr("dialog.cancel"), closeOnBackdrop: options.closeOnBackdrop });
}

function showConfirmWithOption(message, option, options = {}) {
  return showDialog({ mode: "confirm-option", message, option, title: options.title || tr("dialog.confirmTitle"), tone: options.tone, confirmLabel: options.confirmLabel || tr("dialog.ok"), cancelLabel: options.cancelLabel || tr("dialog.cancel"), closeOnBackdrop: options.closeOnBackdrop });
}

function showPrompt(message, defaultValue = "", options = {}) {
  return showDialog({ mode: "prompt", message, value: defaultValue, title: options.title || tr("dialog.promptTitle"), inputLabel: options.inputLabel, placeholder: options.placeholder || "", confirmLabel: options.confirmLabel || tr("dialog.ok"), cancelLabel: options.cancelLabel || tr("dialog.cancel"), selectOnFocus: options.selectOnFocus, closeOnBackdrop: options.closeOnBackdrop });
}

function showPromptWithOption(message, defaultValue, option, options = {}) {
  return showDialog({ mode: "prompt-option", message, value: defaultValue, option, title: options.title || tr("dialog.promptTitle"), inputLabel: options.inputLabel, placeholder: options.placeholder || "", confirmLabel: options.confirmLabel || tr("dialog.ok"), cancelLabel: options.cancelLabel || tr("dialog.cancel"), selectOnFocus: options.selectOnFocus, closeOnBackdrop: options.closeOnBackdrop });
}

function showSelectWithOption(message, defaultValue, selectOptions, option, options = {}) {
  return showDialog({ mode: "select-option", message, value: defaultValue, selectOptions, option, title: options.title || tr("dialog.promptTitle"), inputLabel: options.inputLabel, confirmLabel: options.confirmLabel || tr("dialog.ok"), cancelLabel: options.cancelLabel || tr("dialog.cancel"), closeOnBackdrop: options.closeOnBackdrop });
}

function getImmediateOnlyFileActionOption() {
  return {
    label: tr("fileAction.applyImmediately"),
    checked: true,
    disabled: true,
    hint: tr("fileAction.immediateOnlyHint"),
  };
}

function showDialog(options) {
  return new Promise((resolve) => {
    dialogQueue.push({ options, resolve });
    if (!dialogState.visible) openNextDialog();
  });
}

function openNextDialog() {
  const nextDialog = dialogQueue.shift();
  if (!nextDialog) return;
  activeDialogResolve = nextDialog.resolve;
  Object.assign(dialogState, {
    visible: true,
    mode: nextDialog.options.mode || "alert",
    title: nextDialog.options.title || tr("dialog.alertTitle"),
    message: nextDialog.options.message || "",
    value: nextDialog.options.value || "",
    inputLabel: nextDialog.options.inputLabel || tr("dialog.inputLabel"),
    placeholder: nextDialog.options.placeholder || "",
    selectOptions: nextDialog.options.selectOptions || [],
    optionLabel: nextDialog.options.option?.label || "",
    optionHint: nextDialog.options.option?.hint || "",
    optionChecked: Boolean(nextDialog.options.option?.checked),
    optionDisabled: Boolean(nextDialog.options.option?.disabled),
    confirmLabel: nextDialog.options.confirmLabel || tr("dialog.ok"),
    cancelLabel: nextDialog.options.cancelLabel || tr("dialog.cancel"),
    tone: nextDialog.options.tone || "default",
    selectOnFocus: Boolean(nextDialog.options.selectOnFocus),
    closeOnBackdrop: nextDialog.options.closeOnBackdrop !== false,
  });
  nextTick(() => {
    if (isPromptDialogMode(dialogState.mode)) {
      dialogInput.value?.focus();
      if (dialogState.selectOnFocus) dialogInput.value?.select();
      return;
    }
    if (isSelectDialogMode(dialogState.mode)) {
      dialogSelect.value?.focus();
      return;
    }
    if (isOptionDialogMode(dialogState.mode) && !dialogState.optionDisabled) {
      dialogOptionInput.value?.focus();
      return;
    }
    dialogPrimaryButton.value?.focus();
  });
}

function confirmDialog() {
  const value = isValueDialogMode(dialogState.mode) ? dialogState.value : true;
  settleDialog(isOptionDialogMode(dialogState.mode) ? { value, checked: dialogState.optionChecked } : value);
}

function cancelDialog() {
  settleDialog(isOptionDialogMode(dialogState.mode) ? null : (isValueDialogMode(dialogState.mode) ? null : false));
}

function isPromptDialogMode(mode) {
  return mode === "prompt" || mode === "prompt-option";
}

function isSelectDialogMode(mode) {
  return mode === "select" || mode === "select-option";
}

function isValueDialogMode(mode) {
  return isPromptDialogMode(mode) || isSelectDialogMode(mode);
}

function isOptionDialogMode(mode) {
  return mode === "confirm-option" || mode === "prompt-option" || mode === "select-option";
}

function settleDialog(result) {
  if (!activeDialogResolve) return;
  const resolve = activeDialogResolve;
  activeDialogResolve = null;
  dialogState.visible = false;
  resolve(result);
  nextTick(openNextDialog);
}

function loadMonaco() {
  if (!monacoLoadPromise) {
    monacoLoadPromise = Promise.all([
      import("@vscode/codicons/dist/codicon.css"),
      loadScript(`${MONACO_BASE_URL}/loader.js`),
    ]).then(() => new Promise((resolve, reject) => {
      globalThis.require.config({ paths: { vs: MONACO_BASE_URL } });
      globalThis.require(["vs/editor/editor.main"], () => resolve(globalThis.monaco), reject);
    }).catch((error) => {
      monacoLoadPromise = null;
      throw error;
    }));
  }
  return monacoLoadPromise;
}

function loadScript(src) {
  if (globalThis.require?.config) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Failed to load Monaco Editor"));
    document.head.append(script);
  });
}

function showPanel(view) {
  if (activeView.value === view && sidePanelVisible.value) {
    sidePanelVisible.value = false;
    if (view === "ai") closeAiHistory();
    nextTick(layoutVisibleEditors);
    return;
  }
  if (view !== "ai") closeAiHistory();
  activeView.value = view;
  sidePanelVisible.value = true;
  nextTick(layoutVisibleEditors);
}

function createSshDraft(source = {}) {
  return {
    id: source.id || "",
    name: source.name || "",
    host: source.host || "",
    port: Number(source.port) || 22,
    username: source.username || "",
    authType: source.authType === "privateKey" ? "privateKey" : "password",
    password: source.password || "",
    privateKey: source.privateKey || "",
    passphrase: source.passphrase || "",
    exposeToAi: Boolean(source.exposeToAi),
    whitelistText: Array.isArray(source.whitelist) ? source.whitelist.join("\n") : String(source.whitelistText || ""),
  };
}

function openCreateSshDialog() {
  sshDialog.mode = "create";
  sshDialog.draft = createSshDraft({ port: 22 });
  sshDialog.visible = true;
}

function openEditSshDialog(connection) {
  sshDialog.mode = "edit";
  sshDialog.draft = createSshDraft(connection);
  sshDialog.visible = true;
}

function closeSshDialog() {
  sshDialog.visible = false;
}

function applySshWhitelistTemplateToDialog() {
  sshDialog.draft.whitelistText = String(settings.ssh.whitelistTemplate || DEFAULT_SSH_WHITELIST_TEMPLATE).trim();
}

function resetSshWhitelistTemplate() {
  settings.ssh.whitelistTemplate = DEFAULT_SSH_WHITELIST_TEMPLATE;
}

function applySshTerminalTheme() {
  sshSessions.forEach((session) => {
    session.terminal?.options && (session.terminal.options.theme = getSshTerminalTheme());
  });
}

function saveSshDialog() {
  const config = normalizeSshConfig(sshDialog.draft);
  if (!config.name || !config.host || !config.username) {
    showAlert(tr("ssh.error.required"), { tone: "danger" });
    return;
  }
  if (sshDialog.mode === "edit") {
    const index = settings.ssh.connections.findIndex((item) => item.id === config.id);
    if (index >= 0) settings.ssh.connections.splice(index, 1, config);
  } else {
    settings.ssh.connections.push({ ...config, id: createSshConfigId() });
  }
  closeSshDialog();
}

function normalizeSshConfig(value = {}) {
  const port = Math.max(1, Math.min(Number(value.port) || 22, 65535));
  return {
    id: value.id || "",
    name: String(value.name || "").trim(),
    host: String(value.host || "").trim(),
    port,
    username: String(value.username || "").trim(),
    authType: value.authType === "privateKey" ? "privateKey" : "password",
    password: value.authType === "privateKey" ? "" : String(value.password || ""),
    privateKey: value.authType === "privateKey" ? String(value.privateKey || "") : "",
    passphrase: value.authType === "privateKey" ? String(value.passphrase || "") : "",
    exposeToAi: Boolean(value.exposeToAi),
    whitelist: normalizeSshWhitelist(value.whitelistText ?? value.whitelist),
  };
}

function normalizeSshWhitelist(value) {
  const items = Array.isArray(value) ? value : String(value || "").split(/[\n,]/);
  return uniqueStrings(items).slice(0, 100);
}

function createSshConfigId() {
  return `ssh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function deleteSshConfig(id) {
  const config = getSshConfigById(id);
  if (!config || isSshConnected(id)) return;
  const confirmed = await showConfirm(tr("ssh.confirmDelete", { name: config.name || config.host }), { title: tr("ssh.delete"), tone: "danger" });
  if (!confirmed) return;
  settings.ssh.connections = settings.ssh.connections.filter((item) => item.id !== id);
  disposeSshTerminal(sshSessions.get(id));
  sshSessions.delete(id);
  if (activeSshTerminalId.value === id) activeSshTerminalId.value = "";
  touchSshState();
  setStatus(tr("ssh.deletedStatus", { name: config.name || config.host }), "");
}

function getSshConfigById(id) {
  return settings.ssh.connections.find((connection) => connection.id === id) || null;
}

function isSshConnected(id) {
  sshRevision.value;
  return Boolean(sshSessions.get(id)?.connected);
}

async function connectSshConfig(config) {
  if (!sshFeatureEnabled.value) {
    await showAlert(tr("ssh.error.backendDisabled"), { tone: "danger" });
    return null;
  }
  const normalized = normalizeSshConfig(config);
  const existing = sshSessions.get(normalized.id);
  if (existing?.connected) {
    existing.tabOpen = true;
    activateSshTerminal(normalized.id);
    return existing;
  }
  let xtermBundle;
  try {
    xtermBundle = await loadXtermBundle();
  } catch (error) {
    await showAlert(`${tr("ssh.connectFailed")}: ${error.message}`, { tone: "danger" });
    return null;
  }
  closeSshSession(existing, { silent: true });
  const session = createSshSession(normalized, xtermBundle);
  sshSessions.set(normalized.id, session);
  activeSshTerminalId.value = normalized.id;
  activeDiffPath.value = "";
  touchSshState();
  setStatus(tr("ssh.connecting", { name: session.title }), `${normalized.host}:${normalized.port}`);
  nextTick(attachActiveSshTerminal);

  let socket;
  try {
    session.websocketUrl = buildSshWebSocketUrl();
    socket = new WebSocket(session.websocketUrl);
  } catch (error) {
    failSshConnection(session, translateErrorMessage(error?.message));
    return session;
  }
  session.ws = socket;
  session.connectTimer = window.setTimeout(() => failSshConnection(session, tr("ssh.connectTimeout")), SSH_CONNECT_TIMEOUT_MS);
  socket.addEventListener("open", () => {
    fitSshTerminal(session);
    socket.send(JSON.stringify({ type: "connect", ...buildSshConnectPayload(normalized, session) }));
    startSshHeartbeat(session);
  });
  socket.addEventListener("message", (event) => handleSshWebSocketMessage(session, event.data));
  socket.addEventListener("close", (event) => {
    if (session.closing) {
      markSshSessionClosed(session);
      return;
    }
    if (!session.connected) {
      if (!session.connectFailed) failSshConnection(session, getSshWebSocketCloseReason(event));
      return;
    }
    const reason = getSshWebSocketCloseReason(event);
    if (reason) appendSshOutput(session, `\n[${new Date().toLocaleTimeString(getCurrentLocale())}] ${reason}\n`);
    markSshSessionClosed(session);
  });
  return session;
}

function createSshSession(config, xtermBundle) {
  return {
    configId: config.id,
    title: config.name || config.host,
    host: config.host,
    port: config.port,
    username: config.username,
    connected: false,
    connectionId: "",
    connectionInfo: null,
    output: "",
    tabOpen: true,
    ws: null,
    terminal: createXtermTerminal(xtermBundle.Terminal),
    fitAddon: createXtermFitAddon(xtermBundle.FitAddon),
    terminalAttached: false,
    terminalDataDisposable: null,
    terminalResizeObserver: null,
    cols: 120,
    rows: 30,
    heartbeatTimer: 0,
    connectTimer: 0,
    connectFailed: false,
    failureReason: "",
    closing: false,
    websocketUrl: "",
    startedAt: Date.now(),
    lastActiveAt: Date.now(),
    aiCommandCaptures: new Set(),
  };
}

function createXtermTerminal(TerminalClass) {
  const terminal = markRaw(new TerminalClass({
    cursorBlink: false,
    disableStdin: true,
    convertEol: true,
    fontFamily: "Consolas, 'Courier New', monospace",
    fontSize: 13,
    theme: getSshTerminalTheme(),
  }));
  return terminal;
}

function setSshTerminalInputEnabled(session, enabled) {
  if (!session?.terminal) return;
  session.terminal.options.disableStdin = !enabled;
  session.terminal.options.cursorBlink = Boolean(enabled);
  if (enabled) {
    session.terminal.focus();
  } else {
    session.terminal.blur?.();
  }
}

function createXtermFitAddon(FitAddonClass) {
  return markRaw(new FitAddonClass());
}

function loadXtermBundle() {
  if (!xtermBundlePromise) {
    xtermBundlePromise = Promise.all([
      import("@xterm/xterm"),
      import("@xterm/addon-fit"),
      import("@xterm/xterm/css/xterm.css"),
    ]).then(([xtermModule, fitAddonModule]) => {
      const TerminalClass = resolveModuleConstructor(xtermModule, "Terminal");
      const FitAddonClass = resolveModuleConstructor(fitAddonModule, "FitAddon");
      if (!TerminalClass || !FitAddonClass) throw new Error("Failed to load xterm");
      return { Terminal: TerminalClass, FitAddon: FitAddonClass };
    }).catch((error) => {
      xtermBundlePromise = null;
      throw error;
    });
  }
  return xtermBundlePromise;
}

function resolveModuleConstructor(module, name) {
  const defaultExport = module?.default;
  return module?.[name] || defaultExport?.[name] || (typeof defaultExport === "function" ? defaultExport : null);
}

function getSshTerminalTheme() {
  return sshTerminalThemes[settings.ssh.terminalTheme] || sshTerminalThemes.dark;
}

function attachActiveSshTerminal() {
  const session = activeSshTerminal.value;
  const host = sshTerminalHost.value;
  if (!session || !host) return;
  if (!session.terminal) {
    if (!xtermBundlePromise) return;
    xtermBundlePromise.then((bundle) => {
      if (session.terminal) return;
      session.terminal = createXtermTerminal(bundle.Terminal);
      session.fitAddon = createXtermFitAddon(bundle.FitAddon);
      touchSshState();
      nextTick(attachActiveSshTerminal);
    });
    if (!session.terminal) return;
  }
  if (!session.fitAddon) return;
  host.textContent = "";
  if (!session.terminalAttached) {
    if (session.fitAddon) session.terminal.loadAddon(session.fitAddon);
    session.terminal.open(host);
    session.terminalAttached = true;
    session.terminalDataDisposable = session.terminal.onData((data) => {
      if (session.connected && session.ws?.readyState === WebSocket.OPEN) session.ws.send(JSON.stringify({ type: "input", data }));
    });
    if (window.ResizeObserver) {
      session.terminalResizeObserver = new ResizeObserver(() => scheduleSshTerminalFit(session));
      session.terminalResizeObserver.observe(host);
    }
    if (session.output) session.terminal.write(session.output);
  } else if (session.terminal.element && session.terminal.element.parentElement !== host) {
    host.appendChild(session.terminal.element);
  }
  scheduleSshTerminalFit(session);
  session.terminal.focus();
}

function scheduleActiveSshTerminalFit() {
  const session = activeSshTerminal.value;
  if (session) scheduleSshTerminalFit(session);
}

function scheduleSshTerminalFit(session) {
  requestAnimationFrame(() => fitSshTerminal(session));
}

function fitSshTerminal(session) {
  if (!session?.terminal || !session.fitAddon || !session.terminal.element) return;
  try {
    session.fitAddon.fit();
    const cols = session.terminal.cols;
    const rows = session.terminal.rows;
    if (!cols || !rows) return;
    if (session.cols === cols && session.rows === rows) return;
    session.cols = cols;
    session.rows = rows;
    if (session.connected && session.ws?.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({ type: "resize", cols, rows }));
    }
  } catch (error) {
    console.error("Failed to fit SSH terminal", error);
  }
}

function buildSshConnectPayload(config, session = null) {
  return {
    name: config.name,
    host: config.host,
    port: config.port,
    username: config.username,
    authType: config.authType,
    password: config.authType === "password" ? config.password : "",
    privateKey: config.authType === "privateKey" ? config.privateKey : "",
    passphrase: config.authType === "privateKey" ? config.passphrase : "",
    cols: session?.cols || 120,
    rows: session?.rows || 30,
  };
}

function buildSshWebSocketUrl() {
  const base = new URL(getBackendBaseUrl());
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = SSH_WEBSOCKET_PATH;
  base.search = "";
  const securityKey = String(settings.ssh.securityKey || "").trim();
  if (securityKey) base.searchParams.set("securityKey", securityKey);
  return base.href;
}

function openSftpDialog(mode, connection) {
  if (!connection) return;
  Object.assign(sftpDialog, {
    visible: true,
    mode,
    connectionId: connection.id,
    connectionName: connection.name || connection.host,
    localPath: activePath.value && mode === "upload" ? activePath.value : "",
    remotePath: "",
    useUnsaved: true,
  });
}

function closeSftpDialog() {
  sftpDialog.visible = false;
}

async function submitSftpDialog() {
  const config = getSshConfigById(sftpDialog.connectionId);
  if (!config) {
    await showAlert(tr("sftp.error.connectionMissing"), { tone: "danger" });
    return;
  }
  const options = {
    localPath: sftpDialog.localPath,
    remotePath: sftpDialog.remotePath,
    useUnsaved: Boolean(sftpDialog.useUnsaved),
  };
  closeSftpDialog();
  if (sftpDialog.mode === "upload") {
    void submitSftpUpload(config, options).catch((error) => showAlert(error.message || String(error), { tone: "danger" }));
  } else {
    void submitSftpDownload(config, options).catch((error) => showAlert(error.message || String(error), { tone: "danger" }));
  }
}

async function submitSftpUpload(config, { localPath, remotePath, useUnsaved = false } = {}) {
  validateSftpReady();
  const normalizedLocalPath = normalizeWorkspacePath(localPath);
  const normalizedRemotePath = normalizeSftpRemotePath(remotePath);
  const uploadSource = await getWorkspaceUploadSource(normalizedLocalPath, useUnsaved);
  const task = createSftpTask("upload", config, normalizedLocalPath, normalizedRemotePath, uploadSource.size);
  setStatus(tr("sftp.uploadStarted", { path: normalizedLocalPath }), normalizedRemotePath);
  void runSftpUploadTask(task, config, normalizedLocalPath, normalizedRemotePath, uploadSource);
  return formatSftpTaskForTool(task, "SFTP upload submitted");
}

async function runSftpUploadTask(task, config, normalizedLocalPath, normalizedRemotePath, uploadSource) {
  try {
    const result = await uploadSftpBody(config, normalizedRemotePath, uploadSource.body, uploadSource.size, task, task.signal);
    if (completeSftpTask(task, uploadSource.size)) {
      setStatus(tr("sftp.uploadCompleted", { path: normalizedLocalPath }), normalizedRemotePath);
    }
    return { summary: `Uploaded ${normalizedLocalPath} to ${normalizedRemotePath}`, local_path: normalizedLocalPath, remote_path: normalizedRemotePath, size: result?.data?.size ?? uploadSource.size, result };
  } catch (error) {
    failSftpTask(task, error);
    console.error("SFTP upload failed", error);
  }
}

async function submitSftpDownload(config, { localPath, remotePath } = {}) {
  validateSftpReady();
  const normalizedLocalPath = normalizeWorkspacePath(localPath);
  const normalizedRemotePath = normalizeSftpRemotePath(remotePath);
  const opened = openFiles.get(normalizedLocalPath);
  if (opened?.dirty) throw new Error(`Local file has unsaved changes: ${normalizedLocalPath}`);
  const workspace = captureWorkspace();
  const task = createSftpTask("download", config, normalizedLocalPath, normalizedRemotePath, 0);
  setStatus(tr("sftp.downloadStarted", { path: normalizedRemotePath }), normalizedLocalPath);
  void runSftpDownloadTask(task, config, normalizedLocalPath, normalizedRemotePath, workspace);
  return formatSftpTaskForTool(task, "SFTP download submitted");
}

async function runSftpDownloadTask(task, config, normalizedLocalPath, normalizedRemotePath, workspace) {
  try {
    const size = await downloadSftpToWorkspace(config, normalizedRemotePath, normalizedLocalPath, task, task.signal, workspace);
    if (completeSftpTask(task, size)) {
      setStatus(tr("sftp.downloadCompleted", { path: normalizedRemotePath }), normalizedLocalPath);
    }
    return { summary: `Downloaded ${normalizedRemotePath} to ${normalizedLocalPath}`, local_path: normalizedLocalPath, remote_path: normalizedRemotePath, size };
  } catch (error) {
    failSftpTask(task, error);
    console.error("SFTP download failed", error);
  }
}

function validateSftpReady() {
  validateBackendEnabled();
  if (!isWorkspaceLoaded()) throw new Error(tr("sftp.error.workspaceRequired"));
}

function normalizeSftpRemotePath(path) {
  const value = String(path || "").trim();
  if (!value || value.endsWith("/")) throw new Error("remotePath is required");
  return value;
}

async function getWorkspaceUploadSource(path, useUnsaved) {
  const openedFile = openFiles.get(path);
  if (useUnsaved && openedFile) await awaitLatestStage(openedFile);
  const body = await fileSession.value.readBlob(path, { view: useUnsaved ? "effective" : "base" });
  return { body, size: body.size };
}

function createSftpTask(type, config, localPath, remotePath, total = 0) {
  const controller = new AbortController();
  const task = reactive({
    id: `sftp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    connectionId: config.id,
    connectionName: config.name || config.host,
    localPath,
    remotePath,
    status: "running",
    loaded: 0,
    total: Number(total) || 0,
    error: "",
    signal: controller.signal,
    cancel: () => controller.abort(),
  });
  sftpTasks.unshift(task);
  return task;
}

function completeSftpTask(task, total = task.total) {
  if (task.status === "cancelled") return false;
  task.status = "completed";
  task.loaded = Number(total) || task.loaded;
  task.total = Number(total) || task.total || task.loaded;
  task.cancel = null;
  return true;
}

function failSftpTask(task, error) {
  if (task.status === "cancelled") return;
  if (error?.name === "AbortError") {
    task.status = "cancelled";
    task.error = tr("sftp.cancelled");
  } else {
    task.status = "failed";
    task.error = translateErrorMessage(error?.message || String(error));
  }
  task.cancel = null;
}

function formatSftpTaskForTool(task, summary = "SFTP task") {
  return {
    summary: `${summary}: ${task.id}`,
    task_id: task.id,
    type: task.type,
    status: task.status,
    connection: task.connectionName,
    local_path: task.localPath,
    remote_path: task.remotePath,
    loaded: task.loaded,
    total: task.total,
    progress: task.total ? Math.max(0, Math.min(100, Math.round((task.loaded / task.total) * 100))) : null,
    error: task.error || "",
  };
}

function cancelSftpTask(taskId) {
  const task = sftpTasks.find((item) => item.id === taskId);
  if (!task || !canCancelSftpTask(task)) return false;
  task.status = "cancelled";
  task.error = tr("sftp.cancelled");
  task.cancel?.();
  task.cancel = null;
  return true;
}

function canCancelSftpTask(task) {
  return task?.status === "running" && typeof task.cancel === "function";
}

function formatSftpTaskProgress(task) {
  const loaded = FileUtils.formatFileSize(task.loaded || 0);
  if (!task.total) return loaded;
  const total = FileUtils.formatFileSize(task.total);
  const percent = Math.max(0, Math.min(100, Math.round((task.loaded / task.total) * 100)));
  return `${loaded} / ${total} · ${percent}%`;
}

function uploadSftpBody(config, remotePath, body, size, task, externalSignal) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const url = buildSftpUrl(SFTP_UPLOAD_PATH, { remotePath, createDirs: "true" });
    let aborted = false;
    const abort = () => {
      aborted = true;
      xhr.abort();
    };
    if (externalSignal) {
      if (externalSignal.aborted) {
        reject(Object.assign(new Error(tr("sftp.cancelled")), { name: "AbortError" }));
        return;
      }
      externalSignal.addEventListener("abort", abort, { once: true });
    }
    xhr.open("POST", url.href);
    xhr.responseType = "text";
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    applySftpHeaders(xhr, config);
    task.total = Number(size) || 0;
    xhr.upload.onprogress = (event) => {
      task.loaded = event.loaded;
      if (event.lengthComputable) task.total = event.total;
    };
    xhr.onload = () => {
      if (externalSignal) externalSignal.removeEventListener("abort", abort);
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`${xhr.status} ${xhr.statusText}`));
        return;
      }
      try {
        resolve(parseBackendResult(xhr.responseText));
      } catch (error) {
        reject(error);
      }
    };
    xhr.onerror = () => {
      if (externalSignal) externalSignal.removeEventListener("abort", abort);
      reject(new Error("SFTP upload request failed"));
    };
    xhr.onabort = () => {
      if (externalSignal) externalSignal.removeEventListener("abort", abort);
      reject(Object.assign(new Error(tr("sftp.cancelled")), { name: aborted ? "AbortError" : "Error" }));
    };
    xhr.send(body);
  });
}

async function downloadSftpToWorkspace(config, remotePath, localPath, task, externalSignal, workspace) {
  const targetFile = isCurrentWorkspace(workspace) ? openFiles.get(localPath) : null;
  if (targetFile?.dirty) throw new Error(`Local file has unsaved changes: ${localPath}`);
  if (isExternalWritePath(localPath, workspace.generation)) throw new Error(`Local file is already being replaced: ${localPath}`);
  const writeKey = acquireExternalWritePath(localPath, workspace.generation);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) abort();
    externalSignal.addEventListener("abort", abort, { once: true });
  }
  try {
    const response = await fetch(buildSftpUrl(SFTP_DOWNLOAD_PATH, { remotePath }), {
      method: "GET",
      headers: buildSftpHeaders(config),
      credentials: "omit",
      signal: controller.signal,
    });
    if (response.headers.get("content-type")?.includes("application/json")) {
      parseBackendResult(await response.text());
      throw new Error(tr("sftp.error.backendResponse"));
    }
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    if (isCurrentWorkspace(workspace) && openFiles.get(localPath)?.dirty) throw new Error(`Local file has unsaved changes: ${localPath}`);
    task.total = Number(response.headers.get("content-length")) || 0;
    if (!response.body) throw new Error("Streaming response body is unavailable for SFTP download");
    let loaded = 0;
    const progressStream = response.body.pipeThrough(new TransformStream({
      transform(chunk, streamController) {
        loaded += chunk.byteLength;
        task.loaded = loaded;
        streamController.enqueue(chunk);
      },
    }), { signal: controller.signal });
    await workspace.session.fileSystem.writeStream(localPath, progressStream, {
      createParents: true,
      signal: controller.signal,
      size: task.total || undefined,
    });
    if (isCurrentWorkspace(workspace)) {
      try {
        await reloadFileAfterExternalWrite(localPath, workspace);
      } catch (error) {
        console.warn(`SFTP download completed but workspace refresh failed: ${localPath}`, error);
      }
    }
    return loaded;
  } finally {
    releaseExternalWritePath(writeKey);
    if (externalSignal) externalSignal.removeEventListener("abort", abort);
  }
}

async function reloadFileAfterExternalWrite(path, workspace) {
  if (!isCurrentWorkspace(workspace)) return;
  const existing = openFiles.get(path);
  if (existing?.dirty) throw new Error(`Local file has unsaved changes: ${path}`);
  const wasActive = activePath.value === path;
  const wasClosed = existing?.closed ?? true;
  if (existing) removeFileState(path);
  workspace.session.revert(path);
  workspace.session.forgetBase(path);
  await refreshTree();
  if (!isCurrentWorkspace(workspace)) return;
  if (!existing) return;
  const reloaded = await ensureAnyFileState(path, { closed: wasClosed });
  if (wasActive || !wasClosed) activateFile(reloaded.path);
}

function buildSftpUrl(path, params = {}) {
  const url = new URL(`${getBackendBaseUrl()}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== "") url.searchParams.set(key, String(value));
  });
  return url;
}

function buildSftpHeaders(config) {
  const headers = new Headers();
  const securityKey = String(settings.ssh.securityKey || "").trim();
  if (securityKey) headers.set("X-Ssh-Security-Key", securityKey);
  headers.set("X-Ssh-Connect", encodeSshConnectHeader(buildSshConnectPayload(normalizeSshConfig(config))));
  return headers;
}

function applySftpHeaders(xhr, config) {
  buildSftpHeaders(config).forEach((value, name) => xhr.setRequestHeader(name, value));
}

function encodeSshConnectHeader(payload) {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function parseBackendResult(text) {
  const result = JSON.parse(text || "{}");
  if (result.code !== 200) throw new Error(result.msg ? translateErrorMessage(result.msg) : tr("sftp.error.backendResponse"));
  return result;
}

function handleSshWebSocketMessage(session, raw) {
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    appendSshOutput(session, String(raw || ""));
    return;
  }
  if (event.type === "connected") {
    window.clearTimeout(session.connectTimer);
    session.connectTimer = 0;
    session.connectFailed = false;
    session.closing = false;
    session.connected = true;
    setSshTerminalInputEnabled(session, true);
    session.connectionId = event.connectionId || event.connection?.id || "";
    session.connectionInfo = event.connection || null;
    session.lastActiveAt = Date.now();
    appendSshOutput(session, `[${new Date().toLocaleTimeString(getCurrentLocale())}] ${tr("ssh.connected")}\n`);
    setStatus(tr("ssh.connectedStatus", { name: session.title }), session.connectionId);
    scheduleSshTerminalFit(session);
    return;
  }
  if (event.type === "output") {
    session.lastActiveAt = Date.now();
    appendSshOutput(session, event.data || "");
    return;
  }
  if (event.type === "closed") {
    const message = event.message ? translateErrorMessage(event.message) : tr("ssh.disconnected");
    appendSshOutput(session, `\n[${new Date().toLocaleTimeString(getCurrentLocale())}] ${message}\n`);
    markSshSessionClosed(session);
    return;
  }
  if (event.type === "error") {
    failSshConnection(session, event.message ? translateErrorMessage(event.message) : "");
    return;
  }
  touchSshState();
}

function failSshConnection(session, reason = "") {
  if (!session) return;
  window.clearTimeout(session.connectTimer);
  session.connectTimer = 0;
  session.connectFailed = true;
  session.failureReason = String(reason || "").trim();
  session.closing = false;
  session.connected = false;
  setSshTerminalInputEnabled(session, false);
  window.clearInterval(session.heartbeatTimer);
  session.heartbeatTimer = 0;
  const message = session.failureReason ? `${tr("ssh.connectFailed")}: ${session.failureReason}` : tr("ssh.connectFailed");
  appendSshOutput(session, `\n[${new Date().toLocaleTimeString(getCurrentLocale())}] ${message}\n`);
  setStatus(tr("ssh.connectFailedStatus"), session.failureReason || session.title);
}

function getSshWebSocketCloseReason(event) {
  const reason = String(event?.reason || "").trim();
  if (reason) return translateErrorMessage(reason);
  if (event?.code === 1006) return tr("ssh.websocketAbnormalClose");
  if (event?.code && event.code !== 1000) return tr("ssh.websocketClosed", { code: event.code });
  return "";
}

function appendSshOutput(session, data) {
  if (!session) return;
  const text = String(data || "");
  session.output = `${session.output || ""}${text}`.slice(-SSH_OUTPUT_MAX_CHARS);
  session.aiCommandCaptures?.forEach((capture) => {
    capture.output = `${capture.output}${text}`.slice(-SSH_OUTPUT_MAX_CHARS);
  });
  session.terminal?.write?.(text);
  touchSshState();
}

function startSshHeartbeat(session) {
  window.clearInterval(session.heartbeatTimer);
  session.heartbeatTimer = window.setInterval(() => {
    if (session.ws?.readyState === WebSocket.OPEN) session.ws.send(JSON.stringify({ type: "heartbeat" }));
  }, 25000);
}

function markSshSessionClosed(session) {
  if (!session) return;
  session.connected = false;
  session.closing = false;
  setSshTerminalInputEnabled(session, false);
  window.clearTimeout(session.connectTimer);
  session.connectTimer = 0;
  window.clearInterval(session.heartbeatTimer);
  session.heartbeatTimer = 0;
  setStatus(tr("ssh.closedStatus", { name: session.title }), "");
  touchSshState();
}

function disconnectSshConfig(id) {
  closeSshSession(sshSessions.get(id));
}

function closeSshSession(session, options = {}) {
  if (!session) return;
  session.closing = true;
  window.clearTimeout(session.connectTimer);
  session.connectTimer = 0;
  window.clearInterval(session.heartbeatTimer);
  session.heartbeatTimer = 0;
  if (session.ws?.readyState === WebSocket.OPEN) {
    try { session.ws.send(JSON.stringify({ type: "close" })); } catch {}
  }
  try { session.ws?.close(); } catch {}
  session.connected = false;
  setSshTerminalInputEnabled(session, false);
  if (!options.silent) appendSshOutput(session, `\n[${new Date().toLocaleTimeString(getCurrentLocale())}] ${tr("ssh.disconnected")}\n`);
  touchSshState();
}

function closeAllSshSessions(options = {}) {
  sshSessions.forEach((session) => {
    closeSshSession(session, { silent: true });
    if (options.disposeTerminal) disposeSshTerminal(session);
  });
}

function disposeSshTerminal(session) {
  if (!session) return;
  session.terminalResizeObserver?.disconnect?.();
  session.terminalResizeObserver = null;
  session.terminalDataDisposable?.dispose?.();
  session.terminalDataDisposable = null;
  session.terminal?.dispose?.();
  session.terminal = null;
  session.fitAddon = null;
  session.terminalAttached = false;
}

function activateSshTerminal(configId) {
  const session = sshSessions.get(configId);
  if (!session) return;
  session.tabOpen = true;
  activeSshTerminalId.value = configId;
  activeDiffPath.value = "";
  diffEditor.value?.setModel(null);
  setStatus(session.title, session.connected ? tr("ssh.connected") : tr("ssh.disconnected"));
  nextTick(attachActiveSshTerminal);
}

function closeSshTerminalTab(configId) {
  const session = sshSessions.get(configId);
  if (!session) return;
  closeSshSession(session, { silent: true });
  disposeSshTerminal(session);
  session.tabOpen = false;
  sshSessions.delete(configId);
  if (activeSshTerminalId.value === configId) {
    activeSshTerminalId.value = "";
    activateLastOpenFile();
  }
  touchSshState();
}

function sendSshCommand(session, command) {
  if (!session?.connected || session.ws?.readyState !== WebSocket.OPEN) throw new Error(tr("ssh.disconnected"));
  session.ws.send(JSON.stringify({ type: "input", data: `${command}\n` }));
  session.lastActiveAt = Date.now();
  touchSshState();
}

function touchSshState() {
  sshRevision.value += 1;
}

async function openFolder() {
  if (!window.showDirectoryPicker) {
    setStatus(tr("error.unsupportedBrowser"), "");
    await showAlert(tr("error.unsupportedBrowser"));
    return;
  }
  try {
    const handle = markRaw(await window.showDirectoryPicker({ mode: "readwrite" }));
    await activateWorkspace(handle, handle.name, "local");
    setStatus(tr("status.openedFolder", { name: handle.name }), tr("status.permissionGranted"));
  } catch (error) {
    if (error.name !== "AbortError") reportError("error.openFolder", error);
  }
}

async function openBrowserFolder() {
  if (!window.isSecureContext || !navigator.storage?.getDirectory) {
    setStatus(tr("error.opfsUnsupported"), "");
    await showAlert(tr("error.opfsUnsupported"));
    return;
  }
  try {
    const handle = markRaw(await navigator.storage.getDirectory());
    await activateWorkspace(handle, "OPFS", "opfs");
    setStatus(tr("status.openedFolder", { name: "OPFS" }), tr("status.browserStorage"));
  } catch (error) {
    reportError("error.openFolder", error);
  }
}

async function clearBrowserFolder() {
  if (rootKind.value !== "opfs") return;
  if (!window.isSecureContext || !navigator.storage?.getDirectory) {
    setStatus(tr("error.opfsUnsupported"), "");
    await showAlert(tr("error.opfsUnsupported"));
    return;
  }
  if (!await showConfirm(tr("confirm.clearBrowserFolder"), { title: tr("action.clearBrowserFolder"), tone: "danger" })) return;
  try {
    const handle = await navigator.storage.getDirectory();
    const temporaryFileSystem = createFileSystem({
      type: "opfs",
      config: { handle },
      policy: createFileOperationPolicy(),
    });
    const entries = await temporaryFileSystem.list("");
    for (const entry of entries) await temporaryFileSystem.remove(entry.path, { recursive: entry.kind === "directory" });
    if (rootKind.value === "opfs") {
      fileSession.value.revertAll();
      fileSession.value.forgetBase("");
      resetWorkspaceEditorState();
      await refreshTree({ collapseAll: true });
    }
    setStatus(tr("status.browserFolderCleared"), "OPFS");
  } catch (error) {
    reportError("error.clearBrowserFolder", error);
  }
}

async function activateWorkspace(handle, name, kind) {
  const nextFileSystem = markRaw(createFileSystem({
    type: kind,
    config: { handle },
    policy: createFileOperationPolicy(),
  }));
  const nextSession = markRaw(new FileSession({ fileSystem: nextFileSystem }));
  await nextSession.checkAccess("", { writable: true, request: true });
  cancelRunningSftpTasks();
  workspaceGeneration += 1;
  resetWorkspaceState();
  rootHandle.value = handle;
  rootName.value = name;
  rootKind.value = kind;
  fileSession.value = nextSession;
  await refreshTree({ collapseAll: true });
}

function resetWorkspaceEditorState() {
  resetPreviewState();
  aiCredentialStore.clear();
  diffEditor.value?.setModel(null);
  editor.value?.setModel(null);
  openFiles.forEach((file) => disposeFileModels(file, { force: true }));
  openFiles.clear();
  disposeWorkspaceModels({ force: true });
  diskTree.value = [];
  registerWorkspaceFileActions();
  activePath.value = "";
  activeDiffPath.value = "";
  activeSshTerminalId.value = "";
  collapsedPaths.clear();
  touchDirtyState();
}

function resetWorkspaceState() {
  resetWorkspaceEditorState();
  fileSession.value?.revertAll();
  fileSession.value = null;
}

async function refreshTree(options = {}) {
  const workspace = options.workspace || captureWorkspace();
  const refreshSerial = ++refreshTreeSerial;
  if (!workspace.session || !isCurrentWorkspace(workspace)) return false;
  try {
    const nextDiskTree = await readDirectory("", { count: 0 }, workspace.session.fileSystem);
    const nextAgentsMdContent = await readRootAgentsMdFromDisk(workspace);
    if (!isCurrentWorkspace(workspace) || refreshSerial !== refreshTreeSerial) return false;
    diskTree.value = nextDiskTree;
    agentsMdContent.value = nextAgentsMdContent;
    pruneWorkspaceModels(nextDiskTree);
    registerWorkspaceFileActions();
    if (options.collapseAll) {
      collapsedPaths.clear();
      collectDirectoryPaths(nextDiskTree).forEach((path) => collapsedPaths.add(path));
    }
    setStatus(tr("status.refreshed", { name: rootName.value }), tr("status.itemCount", { count: countTreeNodes(nextDiskTree) }));
    return true;
  } catch (error) {
    if (isCurrentWorkspace(workspace) && refreshSerial === refreshTreeSerial) reportError("error.refreshTree", error);
    return false;
  }
}

function collectDirectoryPaths(nodes) {
  return nodes.flatMap((node) => node.kind === "directory" ? [node.path, ...collectDirectoryPaths(node.children || [])] : []);
}

function collectFileNodes(nodes, maxItems = Number.POSITIVE_INFINITY) {
  const files = [];
  const visit = (node) => {
    if (files.length >= maxItems) return;
    if (node.kind === "file") {
      files.push(node);
      return;
    }
    (node.children || []).forEach(visit);
  };
  nodes.forEach(visit);
  return files;
}

function handleGlobalCommandPaletteShortcut(event) {
  if (dialogState.visible) return;
  if (event.isComposing) return;
  if (isShortcutEvent(settings.shortcuts.save, event)) {
    event.preventDefault();
    saveActiveFile();
    return;
  }
  if (isShortcutEvent(settings.shortcuts.commandPalette, event)) {
    event.preventDefault();
    openCommandPalette();
    return;
  }
  if ((previewVisible.value || canPreviewActiveFile.value) && isShortcutEvent(settings.shortcuts.preview, event)) {
    event.preventDefault();
    togglePreview();
    return;
  }
  if (isShortcutEvent(settings.shortcuts.search, event)) {
    event.preventDefault();
    showPanel("search");
  }
}

function isShortcutEvent(value, event) {
  const shortcut = String(value || "").trim();
  if (shortcut.split(/\s+/).length > 1) return false;
  const parts = shortcut.split("+").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return false;
  const key = parts.pop();
  const modifiers = new Set(parts.map((part) => part.toLowerCase()));
  const wantsCtrlCmd = modifiers.has("ctrl") || modifiers.has("cmd") || modifiers.has("meta") || modifiers.has("ctrlcmd");
  const wantsShift = modifiers.has("shift");
  const wantsAlt = modifiers.has("alt") || modifiers.has("option");
  const hasCtrlCmd = event.ctrlKey || event.metaKey;
  return hasCtrlCmd === wantsCtrlCmd
    && event.shiftKey === wantsShift
    && event.altKey === wantsAlt
    && normalizeShortcutKey(event.key) === normalizeShortcutKey(key);
}

function normalizeShortcutKey(key) {
  const value = String(key || "").trim();
  const aliases = { Esc: "Escape", Del: "Delete", Up: "ArrowUp", Down: "ArrowDown", Left: "ArrowLeft", Right: "ArrowRight", Space: " " };
  const normalized = aliases[value] || value;
  return normalized.length === 1 ? normalized.toLowerCase() : normalized.toLowerCase().replace(/^arrow/, "");
}

function openCommandPalette() {
  registerWorkspaceFileActions();
  const targetEditor = activeDiffPath.value ? diffEditor.value?.getModifiedEditor?.() : editor.value;
  const action = targetEditor?.getAction("editor.action.quickCommand") || editor.value?.getAction("editor.action.quickCommand");
  targetEditor?.focus?.();
  action?.run();
}

async function runGlobalSearch() {
  const query = searchQuery.value.trim();
  if (!query || searchBusy.value || !rootHandle.value) return;
  const requestId = ++searchSerial;
  searchBusy.value = true;
  searchSearched.value = true;
  searchResults.value = [];
  try {
    const fileNodes = collectFileNodes(tree.value, WORKSPACE_SEARCH_FILE_LIMIT);
    const groupedResults = [];
    let totalMatches = 0;
    for (const node of fileNodes) {
      if (requestId !== searchSerial || totalMatches >= WORKSPACE_SEARCH_RESULT_LIMIT) break;
      const content = await readWorkspaceTextForNode(node);
      if (content === null) continue;
      const remaining = WORKSPACE_SEARCH_RESULT_LIMIT - totalMatches;
      const matches = findPlainTextMatches(content, query, searchMatchCase.value, remaining);
      if (!matches.length) continue;
      totalMatches += matches.length;
      groupedResults.push({ path: node.path, name: node.name, matches });
      searchResults.value = groupedResults.slice();
    }
    if (requestId === searchSerial) setStatus(tr("search.results", { count: totalMatches }), query);
  } finally {
    if (requestId === searchSerial) searchBusy.value = false;
  }
}

async function readWorkspaceTextForNode(node, token) {
  if (token?.isCancellationRequested || !node || node.kind !== "file") return null;
  const workspace = captureWorkspace();
  if (!isCurrentWorkspace(workspace) || isExternalWritePath(node.path, workspace.generation)) return null;
  const openFileState = openFiles.get(node.path);
  if (openFileState && !openFileState.deleted) {
    if (!isTextFileState(openFileState)) return null;
    try {
      assertOpenFileMemoryRead(openFileState);
      return openFileState.model.getValue();
    } catch {
      return null;
    }
  }
  if (FileUtils.isImageFileName(node.name) || !isReadableTextEntry(node)) return null;
  try {
    const content = await workspace.session.readText(node.path);
    if (token?.isCancellationRequested || !isCurrentWorkspace(workspace) || isExternalWritePath(node.path, workspace.generation)) return null;
    return content;
  } catch {
    return null;
  }
}

function findPlainTextMatches(content, query, matchCase, limit) {
  const source = matchCase ? content : content.toLowerCase();
  const target = matchCase ? query : query.toLowerCase();
  if (!target || limit <= 0) return [];
  const lineStarts = [0];
  const newlinePattern = /\r\n|\r|\n/g;
  let newlineMatch;
  while ((newlineMatch = newlinePattern.exec(content))) lineStarts.push(newlineMatch.index + newlineMatch[0].length);
  const positionAt = (offset) => {
    let low = 0;
    let high = lineStarts.length;
    while (low + 1 < high) {
      const middle = (low + high) >> 1;
      if (lineStarts[middle] <= offset) low = middle;
      else high = middle;
    }
    return { lineNumber: low + 1, column: offset - lineStarts[low] + 1 };
  };
  const matches = [];
  let searchOffset = 0;
  while (matches.length < limit) {
    const startOffset = source.indexOf(target, searchOffset);
    if (startOffset < 0) break;
    const endOffset = startOffset + target.length;
    const start = positionAt(startOffset);
    const end = positionAt(endOffset);
    const nextLineStart = lineStarts[start.lineNumber] ?? content.length;
    let lineEnd = nextLineStart;
    while (lineEnd > lineStarts[start.lineNumber - 1] && /[\r\n]/.test(content[lineEnd - 1])) lineEnd -= 1;
    matches.push({
      lineNumber: start.lineNumber,
      column: start.column,
      range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
      startIndex: start.column - 1,
      endIndex: start.lineNumber === end.lineNumber ? end.column - 1 : lineEnd - lineStarts[start.lineNumber - 1],
      lineText: content.slice(lineStarts[start.lineNumber - 1], lineEnd),
    });
    searchOffset = Math.max(endOffset, startOffset + 1);
  }
  return matches;
}

function clearSearchResults() {
  searchSerial += 1;
  searchQuery.value = "";
  searchResults.value = [];
  searchBusy.value = false;
  searchSearched.value = false;
}

function getSearchMatchSegments(match) {
  const line = match?.lineText || "";
  const start = Math.max(0, Math.min(match?.startIndex ?? 0, line.length));
  const end = Math.max(start, Math.min(match?.endIndex ?? start, line.length));
  if (start === end) return [{ text: line.trim() || line, match: false }];
  return [
    { text: line.slice(0, start), match: false },
    { text: line.slice(start, end), match: true },
    { text: line.slice(end), match: false },
  ].filter((segment) => segment.text);
}

async function replaceAllSearchResults() {
  if (searchBusy.value || !searchResults.value.length) return;
  const results = searchResults.value.map((result) => ({ ...result, matches: result.matches.slice() }));
  const replacement = searchReplaceText.value;
  let replacedCount = 0;
  for (const result of results) {
    const file = await ensureFileState(result.path, { closed: true });
    if (!file || file.deleted) continue;
    const edits = result.matches
      .slice()
      .sort((a, b) => b.range.startLineNumber - a.range.startLineNumber || b.range.startColumn - a.range.startColumn)
      .map((match) => ({ range: match.range, text: replacement }));
    if (!edits.length) continue;
    let content = file.model.getValue();
    edits.forEach((edit) => {
      const start = file.model.getOffsetAt(edit.range.getStartPosition());
      const end = file.model.getOffsetAt(edit.range.getEndPosition());
      content = `${content.slice(0, start)}${edit.text}${content.slice(end)}`;
    });
    await replaceTextFileContent(file, content);
    replacedCount += edits.length;
  }
  setStatus(tr("search.replaced", { count: replacedCount }), searchQuery.value.trim());
  await runGlobalSearch();
}

async function openSearchResult(result, match) {
  const file = await openFileByPath(result.path);
  if (!file || !match?.range) return;
  await nextTick();
  editor.value?.setSelection(match.range);
  editor.value?.revealRangeInCenter(match.range);
  editor.value?.focus();
}

function registerWorkspaceFileActions() {
  if (!editor.value) {
    workspaceFileActionDisposables.splice(0).forEach((disposable) => disposable.dispose());
    workspaceFileActionKey = "";
    return;
  }
  const targetEditors = [editor.value, diffEditor.value?.getOriginalEditor(), diffEditor.value?.getModifiedEditor()].filter(Boolean);
  const fileNodes = collectFileNodes(tree.value, WORKSPACE_FILE_ACTION_LIMIT);
  const nextKey = fileNodes.map((node) => node.path).join("\0");
  if (nextKey === workspaceFileActionKey && workspaceFileActionDisposables.length) return;
  workspaceFileActionDisposables.splice(0).forEach((disposable) => disposable.dispose());
  workspaceFileActionKey = nextKey;
  fileNodes.forEach((node, nodeIndex) => {
    targetEditors.forEach((targetEditor, editorIndex) => {
      workspaceFileActionDisposables.push(targetEditor.addAction({
        id: `browser-editor-open-file-${editorIndex}-${nodeIndex}-${hashWorkspacePath(node.path)}`,
        label: `Open File: ${node.path}`,
        run: () => openFileByPath(node.path),
      }));
    });
  });
}

function hashWorkspacePath(path) {
  let hash = 0;
  for (let index = 0; index < path.length; index += 1) hash = ((hash << 5) - hash + path.charCodeAt(index)) | 0;
  return Math.abs(hash).toString(36);
}

async function openFileByPath(path) {
  const normalized = normalizeWorkspacePath(path);
  const existing = openFiles.get(normalized);
  if (existing) {
    existing.closed = false;
    activateFile(existing.path);
    return existing;
  }
  const node = findNodeByPath(tree.value, normalized);
  if (node?.kind === "file") return openFile(node);
  return null;
}

function getWorkspaceModelUri(path) {
  return monaco.Uri.parse(`file:///${encodeURI(path)}`);
}

function getOriginalModelUri(path) {
  return monaco.Uri.parse(`inmemory://original/${encodeURIComponent(path)}`);
}

function getPreviewModelUri(path) {
  return monaco.Uri.parse(`inmemory://preview/${encodeURIComponent(path)}`);
}

function getWorkspacePathFromModel(model) {
  return getWorkspacePathFromUri(model?.uri);
}

function getWorkspacePathFromUri(uri) {
  if (uri?.scheme !== "file") return "";
  return decodeURI(uri.path.replace(/^\/+/, ""));
}

function registerWorkspaceEditorOpener() {
  editorOpenerDisposable?.dispose();
  editorOpenerDisposable = monaco.editor.registerEditorOpener({
    async openCodeEditor(_source, resource, selectionOrPosition) {
      const path = getWorkspacePathFromUri(resource);
      if (!path) return false;
      const file = await openFileByPath(path);
      if (!file) return false;
      if (!isTextFileState(file)) return true;
      await nextTick();
      const targetEditor = editor.value;
      if (!targetEditor || targetEditor.getModel() !== file.model) return false;
      revealEditorLocation(targetEditor, selectionOrPosition);
      return true;
    },
  });
}

function revealEditorLocation(targetEditor, selectionOrPosition) {
  if (monaco.Range.isIRange(selectionOrPosition)) {
    targetEditor.setSelection(selectionOrPosition);
    targetEditor.revealRangeInCenter(selectionOrPosition);
  } else if (monaco.Position.isIPosition(selectionOrPosition)) {
    targetEditor.setPosition(selectionOrPosition);
    targetEditor.revealPositionInCenter(selectionOrPosition);
  }
  targetEditor.focus();
}

function getOrCreateWorkspaceModel(content, monacoLanguage, path, syncContent = false) {
  const uri = getWorkspaceModelUri(path);
  const existing = monaco.editor.getModel(uri);
  if (existing) {
    if (existing.getLanguageId() !== monacoLanguage) monaco.editor.setModelLanguage(existing, monacoLanguage);
    if (syncContent && existing.getValue() !== content) existing.setValue(content);
    return markRaw(existing);
  }
  return markRaw(monaco.editor.createModel(content, monacoLanguage, uri));
}

function createOriginalModel(content, monacoLanguage, path) {
  return markRaw(monaco.editor.createModel(content, monacoLanguage, getOriginalModelUri(path)));
}

function ensureOriginalModel(file) {
  if (!isTextFileState(file)) return null;
  if (!file.originalModel || file.originalModel.isDisposed()) {
    file.originalModel = createOriginalModel(file.savedValue, file.monacoLanguage, file.path);
  }
  return file.originalModel;
}

function getOrCreatePreviewModel(content, path) {
  const uri = getPreviewModelUri(path);
  const existing = monaco.editor.getModel(uri);
  if (existing) {
    if (existing.getValue() !== content) existing.setValue(content);
    return markRaw(existing);
  }
  return markRaw(monaco.editor.createModel(content, "plaintext", uri));
}

function pruneWorkspaceModels(nodes) {
  const existingPaths = new Set(collectFileNodes(nodes, Number.POSITIVE_INFINITY).map((node) => node.path));
  Array.from(workspaceModelPaths).forEach((path) => {
    if (existingPaths.has(path) || openFiles.has(path)) return;
    monaco.editor.getModel(getWorkspaceModelUri(path))?.dispose();
    workspaceModelPaths.delete(path);
  });
}

function disposeWorkspaceModels({ force = false } = {}) {
  Array.from(workspaceModelPaths).forEach((path) => {
    if (!force && openFiles.has(path)) return;
    monaco.editor.getModel(getWorkspaceModelUri(path))?.dispose();
    workspaceModelPaths.delete(path);
  });
}

function mergePendingFilesIntoTree(nodes, pendingFiles) {
  const cloned = nodes.map((node) => ({ ...node, children: node.children ? mergePendingFilesIntoTree(node.children, []) : [] }));
  pendingFiles.forEach((file) => upsertPendingFileNode(cloned, file));
  sortTreeNodes(cloned);
  return cloned;
}

function upsertPendingFileNode(nodes, file) {
  const parts = file.path.split("/");
  const name = parts.pop();
  let current = nodes;
  let basePath = "";
  for (const part of parts) {
    const path = basePath ? `${basePath}/${part}` : part;
    let directory = current.find((node) => node.path === path && node.kind === "directory");
    if (!directory) {
      directory = { name: part, path, parentPath: basePath, kind: "directory", size: 0, mimeType: null, version: null, children: [] };
      current.push(directory);
    }
    current = directory.children;
    basePath = path;
  }
  const existing = current.find((node) => node.path === file.path);
  const pendingNode = { name, path: file.path, parentPath: parts.join("/"), kind: "file", size: file.size || 0, mimeType: file.mimeType || getMimeType(file.path), version: file.version ?? null, children: [] };
  if (existing) Object.assign(existing, pendingNode);
  else current.push(pendingNode);
}

function sortTreeNodes(nodes) {
  nodes.sort((a, b) => a.kind !== b.kind ? (a.kind === "directory" ? -1 : 1) : a.name.localeCompare(b.name, getCurrentLocale(), { sensitivity: "base" }));
  nodes.forEach((node) => { if (node.children?.length) sortTreeNodes(node.children); });
}

async function readDirectory(basePath, state = { count: 0 }, sourceFileSystem = fileSession.value.fileSystem) {
  const nodes = [];
  const entries = await sourceFileSystem.list(basePath);
  for (const entry of entries) {
    if (shouldHideName(entry.name)) continue;
    state.count += 1;
    if (state.count > sourceFileSystem.policy.maxWalkEntries) break;
    const node = {
      name: entry.name,
      path: entry.path,
      parentPath: basePath,
      kind: entry.kind,
      size: Number(entry.size) || 0,
      mimeType: entry.mimeType || null,
      version: entry.version ?? null,
      children: [],
    };
    if (entry.kind === "directory") node.children = await readDirectory(entry.path, state, sourceFileSystem);
    nodes.push(node);
  }
  sortTreeNodes(nodes);
  return nodes;
}

async function openFile(node) {
  const workspace = captureWorkspace();
  try {
    const file = await ensureAnyFileState(node.path, { closed: false, workspace });
    if (!isCurrentWorkspace(workspace)) return null;
    file.closed = false;
    activateFile(file.path);
    const detail = file.fileType === "image"
      ? `${tr("imagePreview.type")} | ${FileUtils.formatFileSize(file.size)}`
      : file.fileType === "unsupported"
        ? `${tr("unsupportedFile.type")} | ${FileUtils.formatFileSize(file.size)}`
        : getLanguageLabel(file.language);
    setStatus(tr("status.openedFile", { name: file.name }), detail);
    return file;
  } catch (error) {
    if (isCurrentWorkspace(workspace)) reportError("error.openFile", error);
    return null;
  }
}

function createImageFileState(node, file, options = {}) {
  const blob = markRaw(file);
  const fileState = { name: node.name, path: node.path, fileType: "image", blob, savedBlob: blob, objectUrl: URL.createObjectURL(blob), size: blob.size, mimeType: blob.type || node.mimeType || FileUtils.getImageMimeType(node.name), dirty: false, closed: options.closed ?? true, language: "plaintext", monacoLanguage: "plaintext", isNew: false, persisted: true, deleted: false, version: node.version };
  fileState.model = getOrCreatePreviewModel(getReadonlyPreviewContent(fileState), node.path);
  openFiles.set(node.path, fileState);
  touchDirtyState();
  return fileState;
}

function getActiveImageBlob(file) {
  return file?.fileType === "image" ? file.blob || null : null;
}

function getActiveBlobFile(file) {
  return file?.blob instanceof Blob ? file.blob : null;
}

function setImageFileBlob(file, blob) {
  if (file?.fileType !== "image" || !(blob instanceof Blob)) throw new Error("Image data is not a Blob");
  if (file.objectUrl) URL.revokeObjectURL(file.objectUrl);
  file.blob = markRaw(blob);
  file.objectUrl = URL.createObjectURL(blob);
  file.size = blob.size;
  file.mimeType = blob.type || FileUtils.getImageMimeType(file.name);
  refreshReadonlyPreviewModel(file);
}

function setBinaryFileBlob(file, blob) {
  if (file?.fileType !== "unsupported" || !(blob instanceof Blob)) throw new Error("Binary data is not a Blob");
  file.blob = markRaw(blob);
  file.size = blob.size;
  file.mimeType = blob.type || getMimeType(file.name);
  refreshReadonlyPreviewModel(file);
}

async function stageImageFileBlob(file, blob, options = {}) {
  const workspace = options.workspace || captureWorkspace();
  assertCurrentWorkspace(workspace);
  workspace.session.fileSystem.policy.assertMemoryWrite(file.path, blob.size);
  await queueFileStage(file, (session) => session.stageBlob(file.path, blob, {
    mimeType: blob.type || file.mimeType,
    createOnly: options.createOnly === true,
  }), workspace);
  assertCurrentWorkspace(workspace);
  setImageFileBlob(file, blob);
  file.deleted = false;
  updateDirtyState(file);
}

async function stageBinaryFileBlob(file, blob, options = {}) {
  const workspace = options.workspace || captureWorkspace();
  assertCurrentWorkspace(workspace);
  workspace.session.fileSystem.policy.assertMemoryWrite(file.path, blob.size);
  await queueFileStage(file, (session) => session.stageBlob(file.path, blob, {
    mimeType: blob.type || file.mimeType,
    createOnly: options.createOnly === true,
  }), workspace);
  assertCurrentWorkspace(workspace);
  setBinaryFileBlob(file, blob);
  file.deleted = false;
  updateDirtyState(file);
}

function createUnsupportedFileState(node, options = {}) {
  const fileState = { name: node.name, path: node.path, fileType: "unsupported", size: node.size, mimeType: node.mimeType, dirty: false, closed: options.closed ?? true, language: "plaintext", monacoLanguage: "plaintext", isNew: false, persisted: true, deleted: false, version: node.version };
  fileState.model = getOrCreatePreviewModel(getReadonlyPreviewContent(fileState), node.path);
  openFiles.set(node.path, fileState);
  touchDirtyState();
  return fileState;
}

function createBinaryFileState(node, blob, options = {}) {
  const binaryBlob = markRaw(blob);
  const fileState = { name: node.name, path: node.path, fileType: "unsupported", blob: binaryBlob, savedBlob: binaryBlob, size: binaryBlob.size, mimeType: binaryBlob.type || node.mimeType || getMimeType(node.path), dirty: false, closed: options.closed ?? true, language: "plaintext", monacoLanguage: "plaintext", isNew: false, persisted: true, deleted: false, version: node.version };
  fileState.model = getOrCreatePreviewModel(getReadonlyPreviewContent(fileState), node.path);
  openFiles.set(node.path, fileState);
  touchDirtyState();
  return fileState;
}

function getReadonlyPreviewContent(file) {
  const title = file.fileType === "image" ? tr("imagePreview.type") : tr("unsupportedFile.title");
  return [
    title,
    "",
    file.fileType === "image" ? tr("imagePreview.aria") : tr("unsupportedFile.description"),
    "",
    `Path: ${file.path}`,
    `Size: ${FileUtils.formatFileSize(file.size)}`,
    file.mimeType ? `MIME: ${file.mimeType}` : "",
    file.deleted ? `Status: ${tr("changes.deleted")}` : "",
  ].filter(Boolean).join("\n");
}

function refreshReadonlyPreviewModel(file) {
  if (!file?.model || file.fileType === "text") return;
  const content = getReadonlyPreviewContent(file);
  if (file.model.getValue() !== content) file.model.setValue(content);
}

function activateFile(path) {
  const file = openFiles.get(path);
  if (!file) return;
  activeSshTerminalId.value = "";
  file.closed = false;
  openFiles.set(path, file);
  touchDirtyState();
  if (file.deleted) {
    activateDiff(path);
    return;
  }
  activeDiffPath.value = "";
  diffEditor.value?.setModel(null);
  activePath.value = path;
  if (previewOpenPaths.has(path)) openPreview();
  if (file.fileType === "image") {
    activateReadonlyPreviewEditor(file);
    setStatus(path, `${tr("imagePreview.type")} | ${FileUtils.formatFileSize(file.size)}`);
    return;
  }
  if (file.fileType === "unsupported") {
    activateReadonlyPreviewEditor(file);
    setStatus(path, `${tr("unsupportedFile.type")} | ${FileUtils.formatFileSize(file.size)}`);
    return;
  }
  editor.value.updateOptions({ readOnly: false });
  editor.value.setModel(file.model);
  editor.value.focus();
  setStatus(path, `${getLanguageLabel(file.language)} | ${file.dirty ? tr("status.unsaved") : tr("status.saved")}`);
}

function activateReadonlyPreviewEditor(file) {
  refreshReadonlyPreviewModel(file);
  editor.value.updateOptions({ readOnly: true });
  editor.value.setModel(file.model);
  nextTick(() => editor.value?.focus());
}

function focusActivePreviewEditor() {
  if (activeFile.value?.model || activeDiffFile.value?.model) editor.value?.focus();
}

function activateDiff(path) {
  const file = openFiles.get(path);
  if (!file) return;
  file.closed = false;
  openFiles.set(path, file);
  touchDirtyState();
  activeSshTerminalId.value = "";
  activePath.value = path;
  activeDiffPath.value = path;
  if (!isTextFileState(file)) {
    diffEditor.value?.setModel(null);
    activateReadonlyPreviewEditor(file);
    setStatus(tr("status.diff", { path }), file.deleted ? tr("changes.deleted") : tr("status.unsaved"));
    return;
  }
  diffEditor.value.setModel({ original: ensureOriginalModel(file), modified: file.model });
  nextTick(() => diffEditor.value?.layout());
  setStatus(tr("status.diff", { path }), file.deleted ? tr("changes.deleted") : `${getLanguageLabel(file.language)} | ${file.dirty ? tr("status.unsaved") : tr("status.saved")}`);
}

function closeFile(path) {
  const file = openFiles.get(path);
  if (!file) return;
  closePreview(path);
  if (file.dirty) {
    file.closed = true;
    openFiles.set(path, file);
    touchDirtyState();
  } else {
    disposeFileModels(file);
    openFiles.delete(path);
  }
  if (activePath.value === path) {
    activateLastOpenFile(path);
  }
}

function activateLastOpenFile(excludedPath = "") {
  const nextPath = Array.from(openFiles.values()).filter((file) => !file.closed && file.path !== excludedPath).map((file) => file.path).at(-1) || "";
  activeSshTerminalId.value = "";
  activePath.value = "";
  activeDiffPath.value = "";
  diffEditor.value?.setModel(null);
  if (nextPath) {
    activateFile(nextPath);
  } else {
    editor.value.updateOptions({ readOnly: false });
    editor.value.setModel(null);
  }
}

function removeFileState(path) {
  const file = openFiles.get(path);
  if (!file) return;
  closePreview(path);
  disposeFileModels(file, { force: true });
  openFiles.delete(path);
  removeAiTouchedPath(path);
  selectedChangePaths.delete(path);
  if (activePath.value === path) activateLastOpenFile(path);
}

async function saveActiveFile() {
  const file = activeFile.value;
  if (!file) return;
  try {
    await saveFile(file);
  } catch (error) {
    reportError("error.saveFile", error);
  }
}

async function saveFile(file, options = {}) {
  const refresh = options.refresh ?? true;
  const updateStatus = options.status ?? true;
  await awaitLatestStage(file);
  if (!file.deleted && !isTextFileState(file) && !getActiveBlobFile(file)) {
    if (updateStatus) setStatus(tr("error.unsupportedFile"), file.path);
    return false;
  }
  const committedChange = fileSession.value.getChange(file.path);
  let result;
  try {
    result = await fileSession.value.commit(file.path);
  } catch (error) {
    if (error?.code === FileConflictError.code) {
      try {
        await refreshConflictedFileBase(file);
      } catch (refreshError) {
        console.error("Failed to refresh conflicted file base", refreshError);
      }
    }
    throw error;
  }
  const hasPendingChange = fileSession.value.hasChange(file.path);
  if (file.deleted) {
    const path = file.path;
    removeFileState(path);
    touchDirtyState();
    if (refresh) await refreshTree();
    if (updateStatus) setStatus(tr("status.deleted", { path }), new Date().toLocaleTimeString(getCurrentLocale()));
    return true;
  }
  if (getActiveBlobFile(file)) {
    file.savedBlob = committedChange?.dataType === "blob" ? committedChange.value : getActiveBlobFile(file);
  } else {
    file.savedValue = committedChange?.dataType === "text" ? committedChange.value : file.model.getValue();
    if (!hasPendingChange) {
      file.lastLegalValue = file.savedValue;
      file.lastStagedValue = file.savedValue;
    }
    file.originalModel?.setValue(file.savedValue);
  }
  file.isNew = false;
  file.persisted = true;
  file.version = result?.version ?? file.version;
  updateDirtyState(file);
  if (refresh) await refreshTree();
  if (file.closed && !file.dirty) {
    removeFileState(file.path);
  } else {
    openFiles.set(file.path, file);
  }
  if (!file.dirty) selectedChangePaths.delete(file.path);
  touchDirtyState();
  if (updateStatus) setStatus(tr("status.savedFile", { name: file.name }), file.dirty ? tr("status.unsaved") : new Date().toLocaleTimeString(getCurrentLocale()));
  return true;
}

async function refreshConflictedFileBase(file) {
  const activeSession = fileSession.value;
  let baseEntry = null;
  let latestValue = null;
  let missing = false;
  try {
    const opened = await activeSession.openRead(file.path, { view: "base" });
    activeSession.policy.assertMemoryRead(file.path, opened.size);
    const blob = opened.blob || await FileUtils.streamToBlob(opened.stream);
    activeSession.policy.assertMemoryRead(file.path, blob.size);
    baseEntry = opened;
    latestValue = isTextFileState(file)
      ? await FileUtils.blobToText(blob)
      : blob;
  } catch (error) {
    if (error?.code !== "FILE_NOT_FOUND") throw error;
    missing = true;
  }

  const refreshedChange = await activeSession.refreshChangeBase(file.path, { baseEntry: missing ? null : baseEntry });
  if (activeSession !== fileSession.value) return;
  if (missing) {
    file.isNew = true;
    file.persisted = false;
    file.version = null;
    if (isTextFileState(file)) {
      file.savedValue = "";
      file.originalModel?.setValue("");
    } else if (getActiveBlobFile(file)) {
      file.savedBlob = null;
    }
  } else {
    file.isNew = false;
    file.persisted = true;
    file.version = refreshedChange?.baseVersion ?? baseEntry?.version ?? file.version;
    if (isTextFileState(file)) {
      file.savedValue = latestValue;
      file.originalModel?.setValue(latestValue);
    } else if (getActiveBlobFile(file)) {
      file.savedBlob = markRaw(latestValue);
    }
  }
  updateDirtyState(file);
}

function changeActiveLanguage() {
  if (!activeTextFile.value) return;
  activeFile.value.monacoLanguage = getMonacoLanguageId(activeFile.value.language);
  monaco.editor.setModelLanguage(activeFile.value.model, activeFile.value.monacoLanguage);
  if (activeFile.value.originalModel) monaco.editor.setModelLanguage(activeFile.value.originalModel, activeFile.value.monacoLanguage);
  if (previewOwnerPath.value === activeFile.value.path) {
    const type = getPreviewType(activeFile.value);
    if (type) {
      previewType.value = type;
      void updatePreviewContent({ remountFrame: true });
    } else {
      closePreview();
    }
  }
  setStatus(activeFile.value.path, `${getLanguageLabel(activeFile.value.language)} | ${activeFile.value.dirty ? tr("status.unsaved") : tr("status.saved")}`);
}

function updateDirtyState(file) {
  const blobChanged = Boolean(getActiveBlobFile(file)) && file.blob !== file.savedBlob;
  if (isTextFileState(file)) file.size = fileSession.value.fileSystem.policy.getTextSize(file.model.getValue());
  file.dirty = Boolean(file.isNew || file.deleted || blobChanged) || (isTextFileState(file) && file.model.getValue() !== file.savedValue);
  openFiles.set(file.path, file);
  touchDirtyState();
}

function attachTextModelListener(file) {
  file.modelContentDisposable = file.model.onDidChangeContent(() => {
    if (file.suppressStage || file.deleted) return;
    if (isExternalWritePath(file.path)) {
      restoreLastLegalText(file);
      reportFileOperationError(new Error(`File operation is already in progress: ${file.path}`));
      return;
    }
    const value = file.model.getValue();
    try {
      fileSession.value.fileSystem.policy.assertMemoryWrite(file.path, fileSession.value.fileSystem.policy.getTextSize(value));
    } catch (error) {
      restoreLastLegalText(file);
      reportFileOperationError(error);
      return;
    }
    file.lastLegalValue = value;
    const stage = queueFileStage(file, (session) => !file.isNew && value === file.savedValue
      ? session.revert(file.path)
      : session.stageText(file.path, value, { mimeType: file.mimeType || getMimeType(file.path, "text/plain;charset=utf-8") }));
    stage.catch(() => {
      if (file.model.getValue() !== value) return;
      file.lastLegalValue = file.lastStagedValue ?? file.savedValue;
      restoreLastLegalText(file);
      if (file.stagePromise === stage) {
        file.stagePromise = Promise.resolve();
        file.stageError = null;
      }
    });
    stage.then(() => { file.lastStagedValue = value; }, () => {});
    updateDirtyState(file);
  });
}

function restoreLastLegalText(file) {
  file.suppressStage = true;
  try {
    file.model.setValue(file.lastLegalValue ?? file.savedValue ?? "");
  } finally {
    file.suppressStage = false;
  }
  updateDirtyState(file);
}

function queueFileStage(file, operation, workspace = captureWorkspace()) {
  if (isExternalWritePath(file.path, workspace.generation)) {
    const error = new Error(`File operation is already in progress: ${file.path}`);
    if (isCurrentWorkspace(workspace)) reportFileOperationError(error);
    return Promise.reject(error);
  }
  const activeSession = workspace.session;
  const previous = file.stagePromise || Promise.resolve();
  const promise = previous.catch(() => {}).then(() => {
    if (!activeSession || !isCurrentWorkspace(workspace)) throw new Error("Workspace session changed");
    return operation(activeSession);
  });
  file.stagePromise = promise;
  promise.catch((error) => {
    file.stageError = error;
    if (isCurrentWorkspace(workspace)) reportFileOperationError(error);
  });
  promise.then(() => {
    if (file.stagePromise === promise) file.stageError = null;
  }, () => {});
  return promise;
}

function captureWorkspace() {
  return {
    generation: workspaceGeneration,
    session: fileSession.value,
  };
}

function isCurrentWorkspace(workspace) {
  return workspace?.generation === workspaceGeneration
    && workspace.session === fileSession.value;
}

function assertCurrentWorkspace(workspace) {
  if (isCurrentWorkspace(workspace)) return;
  const error = new Error("Workspace session changed");
  error.name = "AbortError";
  throw error;
}

function getExternalWriteKey(path, generation = workspaceGeneration) {
  return `${generation}:${path}`;
}

function isExternalWritePath(path, generation = workspaceGeneration) {
  let candidate = normalizeFilePath(path);
  while (true) {
    if (externalWritePaths.has(getExternalWriteKey(candidate, generation))) return true;
    if (!candidate) return false;
    candidate = getParentFilePath(candidate);
  }
}

function hasExternalWriteUnder(path, generation = workspaceGeneration) {
  const normalizedPath = normalizeFilePath(path);
  const keyPrefix = `${generation}:`;
  for (const key of externalWritePaths.keys()) {
    if (!key.startsWith(keyPrefix)) continue;
    if (isPathUnder(key.slice(keyPrefix.length), normalizedPath)) return true;
  }
  return false;
}

function acquireExternalWritePath(path, generation = workspaceGeneration) {
  const key = getExternalWriteKey(normalizeFilePath(path), generation);
  externalWritePaths.set(key, (externalWritePaths.get(key) || 0) + 1);
  return key;
}

function releaseExternalWritePath(key) {
  const count = externalWritePaths.get(key) || 0;
  if (count <= 1) externalWritePaths.delete(key);
  else externalWritePaths.set(key, count - 1);
}

async function trackFileLoad(workspace, path, operation) {
  const record = {
    generation: workspace.generation,
    path: normalizeFilePath(path),
    promise: null,
  };
  record.promise = Promise.resolve().then(operation);
  pendingFileLoads.add(record);
  try {
    return await record.promise;
  } finally {
    pendingFileLoads.delete(record);
  }
}

async function awaitPendingFileLoads(workspace, path) {
  const normalizedPath = normalizeFilePath(path);
  while (true) {
    const pending = Array.from(pendingFileLoads)
      .filter((record) => record.generation === workspace.generation && isPathUnder(record.path, normalizedPath))
      .map((record) => record.promise);
    if (!pending.length) return;
    await Promise.allSettled(pending);
  }
}

async function awaitLatestStage(file) {
  let pendingStage = null;
  do {
    pendingStage = file?.stagePromise || null;
    if (pendingStage) await pendingStage;
  } while (file?.stagePromise && file.stagePromise !== pendingStage);
  if (file?.stageError) throw file.stageError;
}

async function replaceTextFileContent(file, value) {
  const text = String(value ?? "");
  fileSession.value.fileSystem.policy.assertMemoryWrite(file.path, fileSession.value.fileSystem.policy.getTextSize(text));
  await queueFileStage(file, (session) => !file.isNew && text === file.savedValue
    ? session.revert(file.path)
    : session.stageText(file.path, text, { mimeType: file.mimeType || getMimeType(file.path, "text/plain;charset=utf-8") }));
  file.suppressStage = true;
  try {
    file.model.setValue(text);
    file.lastLegalValue = text;
    file.lastStagedValue = text;
  } finally {
    file.suppressStage = false;
  }
  updateDirtyState(file);
}

function touchDirtyState() {
  dirtyRevision.value += 1;
}

function toggleChangeSelection(path, selected) {
  selected ? selectedChangePaths.add(path) : selectedChangePaths.delete(path);
}

function toggleAllChangesSelection(selected) {
  selectedChangePaths.clear();
  if (selected) dirtyFiles.value.forEach((file) => selectedChangePaths.add(file.path));
}

function pruneSelectedChangePaths() {
  const dirtyPaths = new Set(dirtyFiles.value.map((file) => file.path));
  Array.from(selectedChangePaths).forEach((path) => {
    if (!dirtyPaths.has(path)) selectedChangePaths.delete(path);
  });
}

async function saveSelectedChanges() {
  const files = selectedChangeFiles.value.slice();
  if (!files.length) return;
  let savedCount = 0;
  try {
    for (const file of files) {
      const saved = await saveFile(file, { refresh: false, status: false });
      if (saved) {
        savedCount += 1;
        selectedChangePaths.delete(file.path);
      }
    }
    await refreshTree();
    touchDirtyState();
    setStatus(tr("changes.batchSaved", { count: savedCount }), new Date().toLocaleTimeString(getCurrentLocale()));
  } catch (error) {
    reportError("error.saveFile", error);
  }
}

async function revertSelectedChanges() {
  const files = selectedChangeFiles.value.slice();
  if (!files.length) return;
  const confirmed = await showConfirm(tr("confirm.revertSelected", { count: files.length }), { title: tr("action.revert"), tone: "danger" });
  if (!confirmed) return;
  let revertedCount = 0;
  for (const file of files) {
    await revertFile(file.path, { confirm: false, status: false });
    selectedChangePaths.delete(file.path);
    revertedCount += 1;
  }
  setStatus(tr("changes.batchReverted", { count: revertedCount }), new Date().toLocaleTimeString(getCurrentLocale()));
}

function toggleDirectory(path) {
  collapsedPaths.has(path) ? collapsedPaths.delete(path) : collapsedPaths.add(path);
}

function showContextMenu(event, node) {
  if (!rootHandle.value) return;
  contextMenu.node = node;
  contextMenu.visible = true;
  nextTick(() => {
    const width = 190;
    const height = 330;
    contextMenu.x = Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8));
    contextMenu.y = Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8));
  });
}

function hideContextMenu() {
  contextMenu.visible = false;
}

function hideAllContextMenus() {
  hideContextMenu();
  hideChangesContextMenu();
  aiSessionMenuVisible.value = false;
}

async function runContextAction(action) {
  const node = contextMenu.node;
  hideContextMenu();
  if (action === "new-file") await createFileFromContext(node);
  if (action === "new-folder") await createFolderFromContext(node);
  if (action === "save-as") await saveNodeAs(node);
  if (action === "rename") await renameNode(node);
  if (action === "move") await moveNode(node);
  if (action === "copy") await copyNode(node);
  if (action === "delete") await deleteNode(node);
  if (action === "refresh") await refreshTree();
}

function getContextDirectoryPath(node) {
  if (!node) return "";
  return node.kind === "directory" ? node.path : node.parentPath;
}

function joinWorkspacePath(basePath, name) {
  return normalizeWorkspacePath(basePath ? `${basePath}/${name}` : name);
}

function getDirectoryPath(path) {
  const normalized = normalizeWorkspacePath(path);
  const index = normalized.lastIndexOf("/");
  return index === -1 ? "" : normalized.slice(0, index);
}

function canRunPersistentNodeAction(node, action) {
  if (!node || !fileSession.value || !findNodeByPath(diskTree.value, node.path)) return false;
  const capability = action === "copy"
    ? (node.kind === "directory" ? "copyDirectory" : "copy")
    : (node.kind === "directory" ? "moveDirectory" : "move");
  return fileSession.value.fileSystem.supports(capability);
}

async function renameNode(node) {
  if (!node) return;
  const workspace = captureWorkspace();
  const selection = await showPromptWithOption(tr("prompt.renameNode"), node.name, getImmediateOnlyFileActionOption(), {
    title: tr("action.rename"),
    inputLabel: tr("dialog.name"),
    confirmLabel: tr("action.rename"),
    selectOnFocus: true,
  });
  const name = selection?.value;
  if (!name || !isCurrentWorkspace(workspace)) return;
  try {
    const destinationPath = joinFilePath(node.parentPath, normalizeNodeName(name));
    await runPersistentNodeTransfer("rename", node, destinationPath, workspace);
  } catch (error) {
    if (isCurrentWorkspace(workspace)) reportError("error.rename", error);
  }
}

async function moveNode(node) {
  if (!node) return;
  const workspace = captureWorkspace();
  const destinations = getNodeDestinationDirectories(node, "move");
  if (!destinations.length) {
    await showAlert(tr("error.noMoveDestination"), { title: tr("action.move") });
    return;
  }
  const selection = await showSelectWithOption(tr("prompt.moveNode", { path: node.path }), destinations[0].value, destinations, getImmediateOnlyFileActionOption(), {
    title: tr("action.move"),
    inputLabel: tr("dialog.destinationFolder"),
    confirmLabel: tr("action.move"),
  });
  const destinationDirectory = selection?.value;
  if (destinationDirectory === undefined || !isCurrentWorkspace(workspace)) return;
  try {
    await runPersistentNodeTransfer("move", node, joinFilePath(destinationDirectory, node.name), workspace);
  } catch (error) {
    if (isCurrentWorkspace(workspace)) reportError("error.move", error);
  }
}

async function copyNode(node) {
  if (!node) return;
  const workspace = captureWorkspace();
  const destinations = getNodeDestinationDirectories(node, "copy");
  const defaultDestination = destinations.find((destination) => destination.value === node.parentPath)?.value ?? destinations[0]?.value;
  const selection = await showSelectWithOption(tr("prompt.copyNode", { path: node.path }), defaultDestination, destinations, getImmediateOnlyFileActionOption(), {
    title: tr("action.copy"),
    inputLabel: tr("dialog.destinationFolder"),
    confirmLabel: tr("action.copy"),
  });
  const destinationDirectory = selection?.value;
  if (destinationDirectory === undefined || !isCurrentWorkspace(workspace)) return;
  try {
    const destinationPath = await resolveCopyDestinationPath(node, destinationDirectory, workspace);
    await runPersistentNodeTransfer("copy", node, destinationPath, workspace);
  } catch (error) {
    if (isCurrentWorkspace(workspace)) reportError("error.copy", error);
  }
}

function getNodeDestinationDirectories(node, action) {
  const directories = [{ value: "", label: tr("workspace.root") }];
  const visit = (nodes) => nodes.forEach((item) => {
    if (item.kind !== "directory") return;
    directories.push({ value: item.path, label: `/${item.path}` });
    visit(item.children || []);
  });
  visit(tree.value);
  return directories.filter((directory) => {
    if (action === "move" && directory.value === node.parentPath) return false;
    if (node.kind !== "directory") return true;
    return directory.value !== node.path && !isPathUnder(directory.value, node.path);
  });
}

async function resolveCopyDestinationPath(node, directoryPath, workspace) {
  const desiredPath = joinFilePath(directoryPath, node.name);
  if (!await nodeDestinationExists(desiredPath, workspace)) return desiredPath;
  const extensionIndex = node.kind === "file" ? node.name.lastIndexOf(".") : -1;
  const hasExtension = extensionIndex > 0;
  const baseName = hasExtension ? node.name.slice(0, extensionIndex) : node.name;
  const extension = hasExtension ? node.name.slice(extensionIndex) : "";
  for (let index = 1; index <= 1000; index += 1) {
    const suffix = index === 1 ? "-copy" : `-copy-${index}`;
    const candidate = joinFilePath(directoryPath, `${baseName}${suffix}${extension}`);
    if (!await nodeDestinationExists(candidate, workspace)) return candidate;
  }
  throw new Error(tr("error.destinationExists", { path: desiredPath }));
}

async function nodeDestinationExists(path, workspace) {
  assertCurrentWorkspace(workspace);
  if (findNodeByPath(tree.value, path) || getOpenFilesUnderPath(path).length) return true;
  return workspace.session.fileSystem.exists(path);
}

function normalizeNodeName(value) {
  const name = decodeWorkspacePath(value).trim();
  if (!name || name === "." || name === ".." || /[\\/\0]/.test(name)) throw new Error(tr("error.invalidName"));
  return name;
}

async function runPersistentNodeTransfer(action, node, destinationPath, workspace = captureWorkspace()) {
  assertCurrentWorkspace(workspace);
  const sourceNode = findNodeByPath(diskTree.value, node.path);
  if (!sourceNode) throw new Error(tr("error.nodeNotPersisted", { path: node.path }));
  if (!canRunPersistentNodeAction(sourceNode, action)) throw new Error(tr("error.nodeActionUnsupported", { path: sourceNode.path }));

  const sourcePath = sourceNode.path;
  if (sourcePath === destinationPath) {
    if (action === "copy") throw new Error(tr("error.destinationExists", { path: destinationPath }));
    return false;
  }
  assertFilePathAncestors(destinationPath);
  if (sourceNode.kind === "directory" && (isPathUnder(destinationPath, sourcePath) || isPathUnder(sourcePath, destinationPath))) {
    throw new Error(tr("error.overlappingNodeTransfer"));
  }
  if (hasExternalWriteOverlap(sourcePath, workspace.generation) || hasExternalWriteOverlap(destinationPath, workspace.generation)) {
    throw new Error(`File operation is already in progress: ${sourcePath}`);
  }

  const sourceOperationKey = acquireExternalWritePath(sourcePath, workspace.generation);
  const destinationOperationKey = acquireExternalWritePath(destinationPath, workspace.generation);
  let mutationAttempted = false;
  let movedOpenFiles = [];
  try {
    await Promise.all([
      awaitPendingFileLoads(workspace, sourcePath),
      awaitPendingFileLoads(workspace, destinationPath),
    ]);
    const affectedFiles = getOpenFilesUnderPath(sourcePath);
    await Promise.all(affectedFiles.map((file) => awaitLatestStage(file)));
    assertCurrentWorkspace(workspace);
    const dirtyFiles = affectedFiles.filter((file) => file.dirty);
    if (dirtyFiles.length) throw new Error(tr("error.unsavedNodeTransfer", { path: sourcePath, count: dirtyFiles.length }));
    if (findNodeByPath(tree.value, destinationPath) || getOpenFilesUnderPath(destinationPath).length) {
      throw new Error(tr("error.destinationExists", { path: destinationPath }));
    }

    const fileSystem = workspace.session.fileSystem;
    const sourceEntry = await fileSystem.stat(sourcePath);
    if (await fileSystem.exists(destinationPath)) throw new Error(tr("error.destinationExists", { path: destinationPath }));
    movedOpenFiles = action === "copy" ? [] : captureMovedOpenFiles(sourcePath, destinationPath);
    const options = {
      recursive: sourceEntry.kind === "directory",
      overwrite: false,
      destinationExpectedVersion: null,
      ...(sourceEntry.version != null ? { sourceExpectedVersion: sourceEntry.version } : {}),
    };
    mutationAttempted = true;
    if (action === "copy") await fileSystem.copy(sourcePath, destinationPath, options);
    else if (action === "rename") await fileSystem.rename(sourcePath, destinationPath, options);
    else await fileSystem.move(sourcePath, destinationPath, options);
    assertCurrentWorkspace(workspace);

    workspace.session.forgetBase(destinationPath);
    if (action !== "copy") {
      workspace.session.forgetBase(sourcePath);
      closeOpenFilesUnderPath(sourcePath);
      remapPathSet(collapsedPaths, sourcePath, destinationPath);
      remapAiTouchedPaths(sourcePath, destinationPath);
    }
    if (searchResults.value.length) clearSearchResults();
  } catch (error) {
    if (mutationAttempted && isCurrentWorkspace(workspace)) {
      workspace.session.forgetBase(sourcePath);
      workspace.session.forgetBase(destinationPath);
      await refreshTree();
    }
    throw error;
  } finally {
    releaseExternalWritePath(destinationOperationKey);
    releaseExternalWritePath(sourceOperationKey);
  }

  if (!isCurrentWorkspace(workspace) || !await refreshTree()) return false;
  if (action !== "copy") {
    await restoreMovedOpenFiles(movedOpenFiles, workspace);
    refreshAiTouchedFlags();
  }
  setStatus(tr(`status.${action === "rename" ? "renamed" : action === "move" ? "moved" : "copied"}`, {
    source: sourcePath,
    destination: destinationPath,
  }), destinationPath);
  return true;
}

function hasExternalWriteOverlap(path, generation = workspaceGeneration) {
  return isExternalWritePath(path, generation) || hasExternalWriteUnder(path, generation);
}

function captureMovedOpenFiles(sourcePath, destinationPath) {
  return getOpenFilesUnderPath(sourcePath).map((file) => ({
    oldPath: file.path,
    newPath: remapPath(file.path, sourcePath, destinationPath),
    closed: file.closed,
    active: activePath.value === file.path,
    diff: activeDiffPath.value === file.path,
    preview: previewOpenPaths.has(file.path),
  }));
}

async function restoreMovedOpenFiles(files, workspace) {
  let activeFileState = null;
  for (const state of files) {
    if (state.closed && !state.active && !state.preview) continue;
    const file = await ensureAnyFileState(state.newPath, { closed: state.closed, workspace });
    if (state.preview) previewOpenPaths.add(state.newPath);
    if (state.active) activeFileState = { ...state, file };
  }
  if (!activeFileState) return;
  if (activeFileState.diff) activateDiff(activeFileState.file.path);
  else activateFile(activeFileState.file.path);
}

function remapPath(path, sourcePath, destinationPath) {
  if (path === sourcePath) return destinationPath;
  return path.startsWith(`${sourcePath}/`) ? `${destinationPath}${path.slice(sourcePath.length)}` : path;
}

function remapPathSet(paths, sourcePath, destinationPath) {
  const affected = Array.from(paths).filter((path) => path === sourcePath || path.startsWith(`${sourcePath}/`));
  affected.forEach((path) => paths.delete(path));
  affected.forEach((path) => paths.add(remapPath(path, sourcePath, destinationPath)));
}

function remapAiTouchedPaths(sourcePath, destinationPath) {
  aiSessions.forEach((session) => remapPathSet(session.touchedPaths, sourcePath, destinationPath));
  refreshAiTouchedFlags();
}

async function saveNodeAs(node) {
  if (!node) return;
  const workspace = captureWorkspace();
  const persistedNode = findNodeByPath(diskTree.value, node.path);
  const hasUnsavedChanges = getOpenFilesUnderPath(node.path).some((file) => file.dirty);
  const requiresUnsavedChanges = !persistedNode;
  const pendingDelete = isPathPendingDelete(node.path);
  const selection = await showConfirmWithOption(tr("saveAs.message"), {
    label: tr("saveAs.includeUnsaved"),
    checked: pendingDelete ? false : (requiresUnsavedChanges || hasUnsavedChanges),
    disabled: pendingDelete || requiresUnsavedChanges || !hasUnsavedChanges,
    hint: pendingDelete
      ? tr("saveAs.pendingDelete")
      : requiresUnsavedChanges
        ? tr("saveAs.includeUnsavedRequired")
        : hasUnsavedChanges
          ? tr("saveAs.includeUnsavedHint")
          : tr("saveAs.noUnsaved"),
  }, {
    title: tr("action.saveAs"),
    confirmLabel: tr("action.saveAs"),
  });
  if (!selection || !isCurrentWorkspace(workspace)) return;
  const includeUnsaved = selection.checked;
  const sourceNode = includeUnsaved ? node : persistedNode;
  if (!sourceNode) return;

  try {
    if (sourceNode.kind === "file") {
      await downloadFile({
        fileName: sourceNode.name,
        mimeType: sourceNode.mimeType || getMimeType(sourceNode.name),
        validateFileHandle: async (destination) => {
          assertCurrentWorkspace(workspace);
          if (await workspace.session.fileSystem.isSameFileTarget(sourceNode.path, destination)) throw new Error(tr("error.saveAsSource"));
        },
        openStream: async () => {
          const source = await openSaveAsRead(sourceNode.path, { includeUnsaved, workspace });
          return {
            stream: source.stream,
            size: source.size,
            mimeType: source.mimeType || sourceNode.mimeType || getMimeType(sourceNode.name),
          };
        },
      });
      assertCurrentWorkspace(workspace);
      setStatus(tr("status.savedAs", { name: sourceNode.name }), sourceNode.path);
      return;
    }
    if (!canUseSaveAsPicker("showDirectoryPicker")) {
      const archiveName = `${sourceNode.name}.zip`;
      setStatus(tr("status.packagingFolder", { name: sourceNode.name }), archiveName);
      const entries = createDirectoryDownloadEntries(sourceNode, { includeUnsaved, workspace });
      await downloadDirectory({name: sourceNode.name, entries, allowDirectoryAccess: false});
      assertCurrentWorkspace(workspace);
      setStatus(tr("status.downloadReady", { name: archiveName }), archiveName);
      return;
    }
    const destinationParent = markRaw(await window.showDirectoryPicker({ mode: "readwrite" }));
    assertCurrentWorkspace(workspace);
    const destinationFileSystem = markRaw(createFileSystem({
      type: "local",
      config: { handle: destinationParent },
      policy: createFileOperationPolicy(),
    }));
    await destinationFileSystem.checkAccess("", { writable: true, request: true });
    assertCurrentWorkspace(workspace);
    const destinationPath = normalizeFilePath(sourceNode.name);
    if (await workspace.session.fileSystem.isCopyDestinationInside(sourceNode.path, destinationFileSystem, destinationPath)) throw new Error(tr("error.destinationInsideSource"));
    assertCurrentWorkspace(workspace);
    const existing = await fileExists(destinationFileSystem, destinationPath);
    assertCurrentWorkspace(workspace);
    if (existing) {
      const merge = await showConfirm(tr("confirm.mergeSaveFolder", { name: sourceNode.name }), { title: tr("action.saveAs") });
      if (!merge || !isCurrentWorkspace(workspace)) return;
    }
    if (!existing) await destinationFileSystem.createDirectory(destinationPath);
    assertCurrentWorkspace(workspace);
    await copyTreeNodes(sourceNode.children || [], destinationFileSystem, destinationPath, { includeUnsaved, workspace });
    assertCurrentWorkspace(workspace);
    setStatus(tr("status.savedAs", { name: sourceNode.name }), sourceNode.path);
  } catch (error) {
    if (error.name !== "AbortError" && isCurrentWorkspace(workspace)) reportError("error.saveAs", error);
  }
}

function canUseSaveAsPicker(method) {
  return window.isSecureContext && typeof window[method] === "function";
}

function isPathPendingDelete(path) {
  return Boolean(path && openFiles.get(path)?.deleted);
}

async function copyTreeNodes(nodes, destinationFileSystem, destinationPath, { includeUnsaved = true, workspace = captureWorkspace() } = {}) {
  for (const node of nodes) {
    assertCurrentWorkspace(workspace);
    if (includeUnsaved && openFiles.get(node.path)?.deleted) continue;
    if (node.kind === "directory") {
      const childDestination = joinFilePath(destinationPath, node.name);
      await destinationFileSystem.createDirectory(childDestination, { recursive: true });
      await copyTreeNodes(node.children || [], destinationFileSystem, childDestination, { includeUnsaved, workspace });
      continue;
    }
    const source = await openSaveAsRead(node.path, { includeUnsaved, workspace });
    await destinationFileSystem.writeStream(joinFilePath(destinationPath, node.name), source.stream, {
      createParents: true,
      size: source.size,
    });
  }
}

function createDirectoryDownloadEntries(node, { includeUnsaved = true, workspace = captureWorkspace() } = {}) {
  const entries = [];
  appendDirectoryDownloadEntries(node.children || [], "", entries, { includeUnsaved, workspace });
  return entries;
}

function appendDirectoryDownloadEntries(nodes, parentPath, entries, { includeUnsaved, workspace }) {
  for (const node of nodes) {
    assertCurrentWorkspace(workspace);
    if (includeUnsaved && openFiles.get(node.path)?.deleted) continue;
    const relativePath = parentPath ? `${parentPath}/${node.name}` : node.name;
    if (node.kind === "directory") {
      entries.push({path: relativePath, directory: true});
      appendDirectoryDownloadEntries(node.children || [], relativePath, entries, { includeUnsaved, workspace });
      continue;
    }
    entries.push({
      path: relativePath,
      size: node.size,
      mimeType: node.mimeType || getMimeType(node.name),
      openStream: async () => {
        const source = await openSaveAsRead(node.path, { includeUnsaved, workspace });
        return source.stream;
      },
    });
  }
}

async function openSaveAsRead(path, { includeUnsaved = true, workspace = captureWorkspace() } = {}) {
  assertCurrentWorkspace(workspace);
  if (!includeUnsaved) return workspace.session.fileSystem.openRead(path);
  const file = openFiles.get(path);
  if (file) await awaitLatestStage(file);
  assertCurrentWorkspace(workspace);
  return workspace.session.openRead(path, { view: "effective" });
}

async function fileExists(targetFileSystem, path) {
  try {
    const entry = await targetFileSystem.stat(path);
    if (entry.kind !== "directory") throw new Error(`Destination path is not a directory: ${path}`);
    return true;
  } catch (error) {
    if (error?.code === "FILE_NOT_FOUND") return false;
    throw error;
  }
}

async function createFileFromContext(node) {
  const workspace = captureWorkspace();
  const selection = await showPromptWithOption(tr("prompt.newFile"), "", {
    label: tr("fileAction.applyImmediately"),
    checked: true,
    hint: tr("fileAction.createImmediateHint"),
  }, {
    title: tr("action.newFile"),
    inputLabel: tr("dialog.filePath"),
    confirmLabel: tr("action.newFile"),
  });
  const name = selection?.value;
  if (!name || !isCurrentWorkspace(workspace)) return;
  try {
    const path = joinWorkspacePath(getContextDirectoryPath(node), name);
    if (findNodeByPath(tree.value, path) || openFiles.has(path)) throw new Error(`File already exists: ${path}`);
    assertFilePathAncestors(path);
    if (selection.checked) {
      await createFileOnDisk(path, workspace);
      if (!isCurrentWorkspace(workspace)) return;
      if (!await refreshTree()) return;
      const createdNode = findNodeByPath(diskTree.value, path);
      if (createdNode) await openFile(createdNode);
    } else {
      const file = await createVirtualFileState(path, { closed: false, workspace });
      if (!isCurrentWorkspace(workspace)) return;
      activateFile(file.path);
      setStatus(tr("status.pendingCreate", { path: file.path }), tr("status.unsaved"));
    }
  } catch (error) {
    if (isCurrentWorkspace(workspace)) reportError("error.createFile", error);
  }
}

async function createFolderFromContext(node) {
  const workspace = captureWorkspace();
  const selection = await showPromptWithOption(tr("prompt.newFolder"), "", getImmediateOnlyFileActionOption(), {
    title: tr("action.newFolder"),
    inputLabel: tr("dialog.folderPath"),
    confirmLabel: tr("action.newFolder"),
  });
  const name = selection?.value;
  if (!name) return;
  try {
    const path = joinWorkspacePath(getContextDirectoryPath(node), name);
    if (!isCurrentWorkspace(workspace)) return;
    if (findNodeByPath(tree.value, path)) throw new Error(`File already exists: ${path}`);
    assertFilePathAncestors(path);
    if (isExternalWritePath(path)) throw new Error(`File operation is already in progress: ${path}`);
    await workspace.session.createDirectory(path, { recursive: true });
    if (!isCurrentWorkspace(workspace) || !await refreshTree()) return;
    setStatus(tr("status.refreshed", { name: rootName.value }), path);
  } catch (error) {
    if (isCurrentWorkspace(workspace)) reportError("error.createFolder", error);
  }
}

function assertFilePathAncestors(path) {
  let parentPath = getParentFilePath(path);
  while (parentPath) {
    if (findNodeByPath(tree.value, parentPath)?.kind === "file") {
      throw new Error(`Parent path is a file: ${parentPath}`);
    }
    parentPath = getParentFilePath(parentPath);
  }
}

async function markNodeDeleted(node, workspace = captureWorkspace()) {
  if (!node || node.kind !== "file" || !isCurrentWorkspace(workspace)) return;
  const file = openFiles.get(node.path);
  if (file?.isNew && !file.persisted) {
    await awaitLatestStage(file).catch(() => {});
    if (!isCurrentWorkspace(workspace)) return;
    workspace.session.revert(node.path);
    removeFileState(node.path);
    setStatus(tr("status.deleted", { path: node.path }), tr("status.unsaved"));
    return;
  }
  await markFileDeleted(node.path, { closed: file?.closed ?? true }, workspace);
}

function showChangesContextMenu(event, file) {
  changesContextMenu.file = file;
  changesContextMenu.visible = true;
  nextTick(() => {
    const width = 190;
    const height = 96;
    changesContextMenu.x = Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8));
    changesContextMenu.y = Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8));
  });
}

function hideChangesContextMenu() {
  changesContextMenu.visible = false;
}

async function runChangesContextAction(action) {
  const file = changesContextMenu.file;
  hideChangesContextMenu();
  if (!file) return;
  if (action === "open-diff") activateDiff(file.path);
  if (action === "revert") await revertFile(file.path);
}

async function revertFile(path, options = {}) {
  const file = openFiles.get(path);
  if (!file || !file.dirty) return;
  if (options.confirm !== false && !await showConfirm(tr("confirm.revert", { path }), { title: tr("action.revert"), tone: "danger" })) return;
  await file.stagePromise?.catch(() => {});
  if (file.isNew) {
    fileSession.value.revert(path);
    removeFileState(path);
    if (options.status !== false) setStatus(tr("status.reverted", { path }), "");
    return;
  }
  file.deleted = false;
  fileSession.value.revert(path);
  if (isTextFileState(file)) {
    file.suppressStage = true;
    file.model.setValue(file.savedValue);
    file.suppressStage = false;
    file.lastLegalValue = file.savedValue;
    file.lastStagedValue = file.savedValue;
    file.originalModel?.setValue(file.savedValue);
  } else if (file.fileType === "image") {
    setImageFileBlob(file, file.savedBlob);
  } else if (getActiveBlobFile(file)) {
    setBinaryFileBlob(file, file.savedBlob);
  } else {
    refreshReadonlyPreviewModel(file);
  }
  file.dirty = false;
  if (file.closed) {
    removeFileState(path);
  } else {
    openFiles.set(path, file);
  }
  touchDirtyState();
  if (!file.closed && activeDiffPath.value === path) activateFile(path);
  selectedChangePaths.delete(path);
  if (options.status !== false) setStatus(tr("status.reverted", { path }), getLanguageLabel(file.language));
}

async function deleteNode(node) {
  if (!node || !rootHandle.value) return;
  const workspace = captureWorkspace();
  const persistedNode = findNodeByPath(diskTree.value, node.path);
  const memoryOnlyNode = !persistedNode;
  const immediateOnly = node.kind === "directory" && !memoryOnlyNode;
  const dirtyFiles = getOpenFilesUnderPath(node.path).filter((file) => file.dirty);
  const selection = await showConfirmWithOption(tr("confirm.delete", {
    path: node.path,
    folderHint: node.kind === "directory" ? tr("confirm.deleteFolderHint") : "",
    dirtyHint: dirtyFiles.length ? tr("confirm.deleteDirtyHint", { count: dirtyFiles.length }) : "",
  }), {
    label: tr("fileAction.applyImmediately"),
    checked: immediateOnly || !memoryOnlyNode,
    disabled: immediateOnly || memoryOnlyNode,
    hint: immediateOnly
      ? tr("fileAction.immediateOnlyHint")
      : memoryOnlyNode
        ? tr("fileAction.unsavedItemDeleteHint")
        : tr("fileAction.deleteImmediateHint"),
  }, {
    title: tr("action.delete"),
    tone: "danger",
    confirmLabel: tr("action.delete"),
  });
  if (!selection || !isCurrentWorkspace(workspace)) return;
  try {
    if (memoryOnlyNode) {
      await discardMemoryOnlyNode(node, workspace);
      return;
    }
    if (!selection.checked) {
      await markNodeDeleted(node, workspace);
      return;
    }
    if (hasExternalWriteUnder(node.path, workspace.generation)) throw new Error(`File operation is already in progress: ${node.path}`);
    const operationKey = acquireExternalWritePath(node.path, workspace.generation);
    try {
      await awaitPendingFileLoads(workspace, node.path);
      const affectedFiles = getOpenFilesUnderPath(node.path);
      await Promise.all(affectedFiles.map((file) => awaitLatestStage(file).catch(() => {})));
      if (!isCurrentWorkspace(workspace)) return;
      await workspace.session.fileSystem.remove(node.path, { recursive: node.kind === "directory" });
      if (!isCurrentWorkspace(workspace)) return;
      workspace.session.forgetBase(node.path);
      closeOpenFilesUnderPath(node.path);
    } finally {
      releaseExternalWritePath(operationKey);
    }
    collapsedPaths.delete(node.path);
    if (!await refreshTree()) return;
    setStatus(tr("status.deleted", { path: node.path }), "");
  } catch (error) {
    if (isCurrentWorkspace(workspace)) reportError("error.delete", error);
  }
}

async function discardMemoryOnlyNode(node, workspace) {
  if (hasExternalWriteUnder(node.path, workspace.generation)) throw new Error(`File operation is already in progress: ${node.path}`);
  const operationKey = acquireExternalWritePath(node.path, workspace.generation);
  try {
    await awaitPendingFileLoads(workspace, node.path);
    const files = getOpenFilesUnderPath(node.path);
    await Promise.all(files.map((file) => awaitLatestStage(file).catch(() => {})));
    if (!isCurrentWorkspace(workspace)) return;
    files.forEach((file) => {
      workspace.session.revert(file.path);
      removeFileState(file.path);
    });
  } finally {
    releaseExternalWritePath(operationKey);
  }
  if (!isCurrentWorkspace(workspace)) return;
  collapsedPaths.delete(node.path);
  setStatus(tr("status.deleted", { path: node.path }), tr("status.unsaved"));
}

function applyTheme() {
  monaco.editor.setTheme(settings.theme);
  diffEditor.value?.updateOptions({ theme: settings.theme });
  applyChromeTheme();
}

function applyChromeTheme() {
  document.body.classList.remove("theme-vs", "theme-vs-dark", "theme-hc-black");
}

function applyLocale(locale) {
  setLocale(locale);
  settings.locale = getCurrentLocale();
  document.documentElement.lang = getCurrentLocale();
}

function applyEditorOptions() {
  editor.value?.updateOptions({ fontSize: settings.fontSize, wordWrap: settings.wordWrap ? "on" : "off", minimap: { enabled: settings.minimap } });
  diffEditor.value?.updateOptions({ fontSize: settings.fontSize, wordWrap: settings.wordWrap ? "on" : "off", minimap: { enabled: settings.minimap } });
}

function resetKeybindings() {
  settings.shortcuts = { ...vscodeShortcuts };
  updateKeybindings();
}

function updateKeybindings() {
  registerKeybindings();
  setStatus(tr("status.shortcutUpdated"), Object.values(settings.shortcuts).join(" · "));
}

function registerKeybindings() {
  keybindingDisposables.splice(0).forEach((disposable) => disposable.dispose());
  const actions = [
    { id: "browser-editor-save", label: tr("action.save"), shortcut: settings.shortcuts.save, run: saveActiveFile },
    { id: "browser-editor-format", label: tr("action.format"), shortcut: settings.shortcuts.format, command: "editor.action.formatDocument" },
    { id: "browser-editor-command-palette", label: tr("commandCenter.title"), shortcut: settings.shortcuts.commandPalette, command: "editor.action.quickCommand" },
    { id: "browser-editor-search", label: tr("panel.search"), shortcut: settings.shortcuts.search, run: () => showPanel("search") },
    { id: "browser-editor-find-references", label: tr("action.findReferences"), shortcut: settings.shortcuts.findReferences, command: "editor.action.goToReferences" },
    { id: "browser-editor-preview", label: tr("action.preview"), shortcut: settings.shortcuts.preview, run: togglePreview },
    { id: "browser-editor-toggle-sidebar", label: tr("action.toggleSidebar"), shortcut: settings.shortcuts.toggleSidebar, run: toggleSidePanel },
    { id: "browser-editor-fold", label: tr("shortcut.fold"), shortcut: settings.shortcuts.fold, command: "editor.fold" },
    { id: "browser-editor-unfold", label: tr("shortcut.unfold"), shortcut: settings.shortcuts.unfold, command: "editor.unfold" },
    { id: "browser-editor-fold-all", label: tr("shortcut.foldAll"), shortcut: settings.shortcuts.foldAll, command: "editor.foldAll" },
    { id: "browser-editor-unfold-all", label: tr("shortcut.unfoldAll"), shortcut: settings.shortcuts.unfoldAll, command: "editor.unfoldAll" },
    { id: "browser-editor-ai-complete", label: tr("action.aiComplete"), shortcut: settings.shortcuts.aiComplete, command: "editor.action.inlineSuggest.trigger" },
  ];
  const validActions = actions.map((action) => ({ ...action, keybinding: parseShortcut(action.shortcut) })).filter((action) => {
    if (!action.keybinding) {
      setStatus(tr("status.shortcutInvalid", { shortcut: action.shortcut }), action.label);
      return false;
    }
    return true;
  });
  validActions.filter((action) => action.command).forEach((action) => {
    keybindingDisposables.push(monaco.editor.addKeybindingRules([
      { keybinding: 0, command: `-${action.command}` },
      { keybinding: action.keybinding, command: action.command },
    ]));
  });
  validActions.filter((action) => !action.command).forEach((action) => {
    keybindingDisposables.push(monaco.editor.addEditorAction({
      id: action.id,
      label: action.label,
      keybindings: [action.keybinding],
      run: action.run,
    }));
  });
}

function parseShortcut(value) {
  const shortcut = String(value || "").trim();
  if (!shortcut || /\s/.test(shortcut)) return null;
  const parts = shortcut.split("+").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return null;
  let code = 0;
  const key = parts.pop();
  parts.forEach((part) => {
    const mod = part.toLowerCase();
    if (mod === "ctrl" || mod === "cmd" || mod === "meta" || mod === "ctrlcmd") code |= monaco.KeyMod.CtrlCmd;
    if (mod === "shift") code |= monaco.KeyMod.Shift;
    if (mod === "alt" || mod === "option") code |= monaco.KeyMod.Alt;
  });
  const keyCode = getMonacoKeyCode(key);
  return keyCode ? code | keyCode : null;
}

function getMonacoKeyCode(key) {
  const normalized = key.trim();
  if (/^[a-z]$/i.test(normalized)) return monaco.KeyCode[`Key${normalized.toUpperCase()}`];
  if (/^[0-9]$/.test(normalized)) return monaco.KeyCode[`Digit${normalized}`];
  if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(normalized)) return monaco.KeyCode[normalized.toUpperCase()];
  const aliases = { Enter: "Enter", Esc: "Escape", Escape: "Escape", Space: "Space", Tab: "Tab", Backspace: "Backspace", Delete: "Delete", Del: "Delete", Up: "UpArrow", Down: "DownArrow", Left: "LeftArrow", Right: "RightArrow", "[": "BracketLeft", "]": "BracketRight" };
  return monaco.KeyCode[aliases[normalized] || normalized];
}

function parseCommaList(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function getAgentModels() {
  const models = parseCommaList(settings.ai.agentModels);
  return models.length ? models : parseCommaList(defaultAiSettings.agentModels);
}

function normalizeAgentModelsInput() {
  const models = uniqueStrings(parseCommaList(settings.ai.agentModels));
  if (!models.length) return;
  settings.ai.agentModels = models.join(",");
}

function addAgentModelFromSelect() {
  if (!agentModelToAdd.value) return;
  const models = uniqueStrings([...parseCommaList(settings.ai.agentModels), agentModelToAdd.value]);
  settings.ai.agentModels = models.join(",");
  agentModelToAdd.value = "";
}

function uniqueStrings(values) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function getCurrentBackendBaseUrl() {
  return window.location.origin && window.location.origin !== "null" ? window.location.origin : "";
}

function normalizeBackendBaseUrlValue(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function normalizeBackendBaseUrl() {
  settings.backend.baseUrl = normalizeBackendBaseUrlValue(settings.backend.baseUrl) || defaultBackendSettings.baseUrl;
}

function isBackendEnabled() {
  return Boolean(settings.backend?.enabled);
}

function isWorkspaceLoaded() {
  return Boolean(fileSession.value);
}

function validateBackendEnabled() {
  if (!isBackendEnabled()) throw new Error(tr("ai.error.backendDisabled"));
}

function getAiExposedSshConfigs() {
  return (settings.ssh?.connections || []).filter((connection) => connection.exposeToAi);
}

function isSshAiAvailable() {
  return isBackendEnabled() && getAiExposedSshConfigs().length > 0;
}

function getBackendBaseUrl() {
  const baseUrl = normalizeBackendBaseUrlValue(settings.backend?.baseUrl) || defaultBackendSettings.baseUrl;
  try {
    return new URL(baseUrl).href.replace(/\/+$/, "");
  } catch {
    throw new Error(tr("ai.error.invalidBackendBaseUrl"));
  }
}

function validateAiConfig(model) {
  if (!settings.ai.apiKey.trim() || !model) throw new Error(tr("ai.error.missingConfig"));
}

function validateAiApiKey() {
  if (!settings.ai.apiKey.trim()) throw new Error(tr("ai.error.missingApiKey"));
}

function getAiBaseUrl() {
  const baseUrl = (settings.ai.baseUrl.trim() || defaultAiSettings.baseUrl).replace(/\/+$/, "");
  return baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
}

async function callOpenAiResponses(payload, signal) {
  const startedAt = performance.now();
  for (let retry = 0; ; retry += 1) {
    try {
      return await requestOpenAiResponse(payload, signal, startedAt);
    } catch (error) {
      if (signal?.aborted || error.name === "AbortError" || retry >= AI_RESPONSE_RETRY_DELAYS_MS.length || !isRetryableAiResponseError(error)) throw error;
      const retryDelay = error.retryAfterMs ?? AI_RESPONSE_RETRY_DELAYS_MS[retry];
      await delayWithAbortSignal(retryDelay, signal);
    }
  }
}

async function requestOpenAiResponse(payload, signal, startedAt) {
  const response = await fetch(`${getAiBaseUrl()}/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.ai.apiKey.trim()}` },
    body: JSON.stringify({ ...payload, stream: true }),
    signal,
  });
  if (!response.ok || !response.headers.get("content-type")?.includes("text/event-stream")) {
    const raw = await response.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { message: raw };
    }
    Object.defineProperty(data, "__meta", { value: { ms: Math.round(performance.now() - startedAt), bytes: raw.length }, enumerable: false });
    if (!response.ok) {
      const error = new Error(data.error?.message || data.message || response.statusText);
      error.status = response.status;
      error.retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      throw error;
    }
    return data;
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("Streaming response body is unavailable");
  const decoder = new TextDecoder();
  let buffer = "";
  let bytes = 0;
  let completedResponse = null;
  const processEvent = (block) => {
    const eventData = block.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!eventData || eventData === "[DONE]") return;
    const event = JSON.parse(eventData);
    if (event.type === "response.completed" || event.type === "response.incomplete") completedResponse = event.response;
    if (event.type === "response.failed") throw new Error(event.response?.error?.message || "AI response failed");
    if (event.type === "error") throw new Error(event.message || event.error?.message || "AI streaming response failed");
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    blocks.forEach(processEvent);
  }
  buffer += decoder.decode();
  if (buffer.trim()) processEvent(buffer);
  if (!completedResponse) throw new Error("AI streaming response ended before completion");
  const data = completedResponse;
  Object.defineProperty(data, "__meta", { value: { ms: Math.round(performance.now() - startedAt), bytes }, enumerable: false });
  return data;
}

function isRetryableAiResponseError(error) {
  const status = Number(error?.status);
  if ([408, 409, 425, 429].includes(status) || (status >= 500 && status < 600)) return true;
  if (error instanceof TypeError) return true;
  return /(?:overloaded|server busy|try again later|temporarily unavailable|temporary capacity)/i.test(error?.message || "");
}

function parseRetryAfterMs(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : null;
}

function delayWithAbortSignal(ms, signal) {
  if (signal?.aborted) return Promise.reject(createAiAbortError());
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(done, ms);
    signal?.addEventListener("abort", abort, { once: true });

    function done() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }

    function abort() {
      window.clearTimeout(timer);
      reject(createAiAbortError());
    }
  });
}

async function callOpenAiImage(options, signal) {
  const model = settings.ai.imageModel.trim();
  validateAiConfig(model);
  const isDallE = /^dall-e-/i.test(model);
  if (isDallE && options.outputFormat !== "png") throw new Error(`${model} output must use a .png path`);
  if (/^dall-e-3$/i.test(model) && options.inputBlob) throw new Error("dall-e-3 does not support image edits");
  if (/^dall-e-2$/i.test(model) && options.inputBlob) {
    const inputType = FileUtils.getImageMimeType(options.inputName, options.inputBlob.type);
    if (inputType !== "image/png") throw new Error("dall-e-2 edits require a PNG input image");
    if (options.inputBlob.size > AI_IMAGE_MASK_MAX_FILE_SIZE) throw new Error(`dall-e-2 edit input exceeds ${FileUtils.formatFileSize(AI_IMAGE_MASK_MAX_FILE_SIZE)}`);
    const dimensions = await readImageDimensions(options.inputBlob);
    if (dimensions.width && dimensions.width !== dimensions.height) throw new Error("dall-e-2 edits require a square input image");
  }
  const common = isDallE
    ? { model, prompt: options.prompt, response_format: "b64_json" }
    : { model, prompt: options.prompt, size: options.size || "auto", quality: options.quality || "auto", background: options.background || "auto", output_format: options.outputFormat };
  if (isDallE && options.size && options.size !== "auto") common.size = options.size;
  if (/^dall-e-3$/i.test(model) && options.quality && options.quality !== "auto") common.quality = normalizeDallE3Quality(options.quality);
  let endpoint = "generations";
  let body;
  let headers = { Authorization: `Bearer ${settings.ai.apiKey.trim()}` };
  if (options.inputBlob) {
    endpoint = "edits";
    const form = new FormData();
    Object.entries(common).forEach(([key, value]) => { if (value) form.append(key, value); });
    form.append("image", new File([options.inputBlob], options.inputName || "input.png", { type: options.inputBlob.type || "image/png" }));
    if (options.maskBlob) form.append("mask", new File([options.maskBlob], options.maskName || "mask.png", { type: options.maskBlob.type || "image/png" }));
    body = form;
  } else {
    headers = { ...headers, "Content-Type": "application/json" };
    body = JSON.stringify({ ...common, n: 1 });
  }
  const response = await fetch(`${getAiBaseUrl()}/images/${endpoint}`, { method: "POST", headers, body, signal });
  const data = await readBoundedJsonResponse(response, getImageJsonResponseLimit(options.outputPath));
  if (!response.ok) throw new Error(data.error?.message || data.message || response.statusText);
  const item = data.data?.[0] || data;
  let blob;
  if (item.b64_json || item.base64) {
    const encoded = item.b64_json || item.base64;
    assertImageOutputSize(options.outputPath, FileUtils.getBase64DecodedSize(encoded));
    blob = FileUtils.base64ToBlob(encoded, getImageMimeTypeForFormat(options.outputFormat));
  } else if (item.url) {
    const imageResponse = await fetch(item.url, { signal });
    if (!imageResponse.ok) throw new Error(`Failed to download generated image: ${imageResponse.statusText}`);
    const contentLength = Number(imageResponse.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength >= 0) assertImageOutputSize(options.outputPath, contentLength);
    blob = await readBoundedBlobResponse(imageResponse, options.outputPath, getImageOutputLimit());
  } else {
    throw new Error("Image API response did not include b64_json or url");
  }
  if (!blob.type || blob.type === "application/octet-stream") blob = FileUtils.withBlobType(blob, getImageMimeTypeForFormat(options.outputFormat));
  assertImageOutputSize(options.outputPath, blob.size);
  return blob;
}

function assertImageOutputSize(path, size) {
  const maxSize = getImageOutputLimit();
  if (Number.isFinite(size) && size > maxSize) throw new FileTooLargeError(path || "generated-image", { size, maxSize, operation: "AI image output" });
}

function getImageOutputLimit() {
  return Math.min(AI_IMAGE_OUTPUT_MAX_FILE_SIZE, fileSession.value.fileSystem.policy.maxMemoryWriteBytes);
}

function getImageJsonResponseLimit(path) {
  const outputLimit = getImageOutputLimit();
  const encodedLimit = Math.ceil((outputLimit * 4) / 3) + MEBIBYTE;
  return { path: path || "generated-image", maxSize: encodedLimit, operation: "AI image JSON response" };
}

async function readBoundedJsonResponse(response, limit) {
  const blob = await readBoundedBlobResponse(response, limit.path, limit.maxSize, limit.operation);
  try {
    return JSON.parse(await blob.text());
  } catch {
    return {};
  }
}

async function readBoundedBlobResponse(response, path, maxSize, operation = "AI image output") {
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > maxSize) {
    throw new FileTooLargeError(path, { size: declaredSize, maxSize, operation });
  }
  if (!response.body) throw new Error(`Streaming response body is unavailable for ${operation}`);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxSize) {
        await reader.cancel().catch(() => {});
        throw new FileTooLargeError(path, { size, maxSize, operation });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Blob(chunks, { type: response.headers.get("content-type") || "application/octet-stream" });
}

function getImageMimeTypeForFormat(format) {
  return { jpeg: "image/jpeg", jpg: "image/jpeg", webp: "image/webp", png: "image/png" }[String(format || "png").toLowerCase()] || "image/png";
}

function normalizeDallE3Quality(value) {
  const quality = String(value || "").toLowerCase();
  if (quality === "high" || quality === "hd") return "hd";
  if (["low", "medium", "standard"].includes(quality)) return "standard";
  throw new Error(`Unsupported dall-e-3 quality: ${value}`);
}

async function fetchAiModels() {
  if (aiModelsLoading.value) return;
  try {
    validateAiApiKey();
    aiModelsLoading.value = true;
    const response = await fetch(`${getAiBaseUrl()}/models`, {
      headers: { Authorization: `Bearer ${settings.ai.apiKey.trim()}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message || data.message || response.statusText);
    const models = uniqueStrings((data.data || []).map((model) => model.id || model.name || model.model));
    aiAvailableModels.value = models;
    if (models.length) {
      if (!settings.ai.completionModel.trim()) settings.ai.completionModel = models[0];
      if (!parseCommaList(settings.ai.agentModels).length) settings.ai.agentModels = models[0];
    }
    setStatus(tr("status.aiModelsLoaded", { count: models.length }), getAiBaseUrl());
  } catch (error) {
    setStatus(tr("status.aiModels"), error.message || String(error));
    showAlert(`${tr("settings.aiFetchModels")}: ${error.message || error}`, { tone: "danger" });
  } finally {
    aiModelsLoading.value = false;
  }
}

function extractResponseText(response) {
  if (typeof response.output_text === "string") return response.output_text.trim();
  const parts = [];
  for (const item of response.output || []) {
    if (item.type === "message") {
      for (const content of item.content || []) {
        if (typeof content.text === "string") parts.push(content.text);
        if (typeof content.output_text === "string") parts.push(content.output_text);
      }
    }
  }
  return parts.join("\n").trim();
}

function extractFunctionCalls(response) {
  return (response.output || []).filter((item) => item.type === "function_call" && item.name);
}

function createAiSessionDraft(options = {}) {
  return {
    title: "",
    agentModel: String(options.agentModel || getAgentModels()[0] || "").trim(),
    reasoningEffort: settings.ai.reasoningEffort,
    prompt: "",
    saved: Boolean(settings.ai.autoSaveSessions),
    pendingAttachments: [],
  };
}

function resetAiSessionDraft(options = {}) {
  Object.assign(aiSessionDraft, createAiSessionDraft(options));
}

function createAiSession(options = {}) {
  aiSessionSerial += 1;
  const reasoningEffort = options.reasoningEffort || settings.ai.reasoningEffort;
  const now = Date.now();
  const fallbackTitle = tr("ai.defaultSessionTitle", { count: aiSessionSerial });
  return {
    id: `ai-session-${Date.now()}-${aiSessionSerial}`,
    title: String(options.title || "").trim() || fallbackTitle,
    agentModel: String(options.agentModel || getAgentModels()[0] || "").trim(),
    reasoningEffort: aiReasoningEfforts.includes(reasoningEffort) ? reasoningEffort : defaultAiSettings.reasoningEffort,
    prompt: "",
    messages: [],
    pendingAttachments: [],
    touchedPaths: new Set(),
    saved: options.saved ?? Boolean(settings.ai.autoSaveSessions),
    busy: false,
    abortController: null,
    titleBusy: false,
    titleAbortController: null,
    contextUsage: null,
    createdAt: Number(options.createdAt) || now,
    updatedAt: Number(options.updatedAt) || now,
  };
}

async function restoreSavedAiSessions() {
  try {
    const stored = await aiSessionStore.list();
    const sessions = stored.map(normalizeStoredAiSession).filter(Boolean);
    if (sessions.length) {
      updatingAiSessionTimestamps = true;
      aiSessions.splice(0, aiSessions.length, ...sessions);
      updatingAiSessionTimestamps = false;
      aiSessionSerial = Math.max(sessions.length, ...sessions.map((session) => getAiSessionSerialFromId(session.id)));
    }
  } catch (error) {
    console.warn("Failed to load saved AI sessions", error);
  } finally {
    aiSessionsReady = true;
    resetAiSessionDraft();
    refreshAiSessionFingerprints();
    queuePersistSavedAiSessions();
  }
}

function getAiSessionSerialFromId(id) {
  const match = String(id || "").match(/-(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function normalizeStoredAiSession(value, index) {
  if (!value || typeof value !== "object" || !Array.isArray(value.messages)) return null;
  const fallbackTitle = tr("ai.defaultSessionTitle", { count: index + 1 });
  return {
    id: String(value.id || `ai-session-${Date.now()}-saved-${index + 1}`),
    title: String(value.title || fallbackTitle).trim() || fallbackTitle,
    agentModel: String(getAgentModels()[0] || "").trim(),
    reasoningEffort: settings.ai.reasoningEffort,
    prompt: "",
    messages: value.messages.map(normalizeStoredAiMessage).filter(Boolean),
    pendingAttachments: [],
    touchedPaths: new Set(),
    saved: true,
    busy: false,
    abortController: null,
    titleBusy: false,
    titleAbortController: null,
    contextUsage: null,
    createdAt: normalizeAiSessionTimestamp(value.createdAt),
    updatedAt: normalizeAiSessionTimestamp(value.updatedAt || value.createdAt),
  };
}

function normalizeStoredAiMessage(value) {
  if (!value || typeof value !== "object" || !["user", "assistant", "tool"].includes(value.role)) return null;
  return {
    id: String(value.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`),
    role: value.role,
    content: String(value.content || ""),
  };
}

function normalizeAiSessionTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now();
}

function handleAiSessionsChanged() {
  if (updatingAiSessionTimestamps) return;
  const now = Date.now();
  updatingAiSessionTimestamps = true;
  aiSessions.forEach((session) => {
    const fingerprint = createAiSessionFingerprint(session);
    if (aiSessionFingerprints.get(session.id) === fingerprint) return;
    session.updatedAt = now;
    aiSessionFingerprints.set(session.id, fingerprint);
  });
  Array.from(aiSessionFingerprints.keys()).forEach((id) => {
    if (!aiSessions.some((session) => session.id === id)) aiSessionFingerprints.delete(id);
  });
  updatingAiSessionTimestamps = false;
  queuePersistSavedAiSessions();
}

function refreshAiSessionFingerprints() {
  aiSessionFingerprints.clear();
  aiSessions.forEach((session) => aiSessionFingerprints.set(session.id, createAiSessionFingerprint(session)));
}

function createAiSessionFingerprint(session) {
  return JSON.stringify({ saved: session.saved, prompt: session.prompt, ...serializeAiSessionContent(session) });
}

function queuePersistSavedAiSessions() {
  if (!aiSessionsReady) return;
  const records = aiSessions.filter((session) => session.saved).map(serializeAiSession);
  aiSessionPersistTask = aiSessionPersistTask
    .catch(() => {})
    .then(() => aiSessionStore.replace(records))
    .catch((error) => console.warn("Failed to save AI sessions", error));
}

function serializeAiSession(session) {
  return {
    ...serializeAiSessionContent(session),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function serializeAiSessionContent(session) {
  return {
    id: session.id,
    title: String(session.title || "").trim() || tr("ai.defaultSessionTitle", { count: aiSessions.indexOf(session) + 1 }),
    messages: session.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.tool?.pending ? tr("ai.toolCancelled") : String(message.content || ""),
    })),
  };
}

function getActiveAiSession() {
  if (activeAiSession.value) return activeAiSession.value;
  throw new Error("No active AI session");
}

function createAiSessionAndActivate() {
  if (!activeAiSession.value) return;
  const agentModel = activeAiSession.value.agentModel;
  activeAiSessionId.value = "";
  resetAiSessionDraft({ agentModel });
  closeAiHistory();
}

function normalizeActiveAiSessionTitle() {
  if (activeAiSession.value) {
    activeAiSession.value.title = activeAiSession.value.title.trim() || tr("ai.defaultSessionTitle", { count: aiSessions.indexOf(activeAiSession.value) + 1 });
  } else {
    aiSessionDraft.title = aiSessionDraft.title.trim();
  }
}

function startAiSessionTitleEdit() {
  aiSessionMenuVisible.value = false;
  aiSessionTitleEditing.value = true;
  nextTick(() => {
    aiSessionTitleInput.value?.focus();
    aiSessionTitleInput.value?.select();
  });
}

function finishAiSessionTitleEdit() {
  if (!aiSessionTitleEditing.value) return;
  normalizeActiveAiSessionTitle();
  aiSessionTitleEditing.value = false;
}

function openAiHistory() {
  aiSessionMenuVisible.value = false;
  aiHistoryVisible.value = true;
  nextTick(() => aiHistorySearchInput.value?.focus());
}

function closeAiHistory() {
  aiHistoryVisible.value = false;
  aiHistoryQuery.value = "";
}

function activateAiHistorySession(id) {
  const session = aiSessions.find((item) => item.id === id);
  if (!session) return;
  resetAiSessionDraft();
  activeAiSessionId.value = session.id;
  closeAiHistory();
}

function matchesAiHistoryQuery(session, query) {
  const normalizedQuery = String(query || "").trim().toLocaleLowerCase(getCurrentLocale());
  if (!normalizedQuery) return true;
  return [session.title, session.prompt, ...session.messages.map((message) => message.content)]
    .some((value) => String(value || "").toLocaleLowerCase(getCurrentLocale()).includes(normalizedQuery));
}

function groupAiSessionDrawerItems(sessions) {
  const running = sessions.filter((session) => session.busy || session.titleBusy);
  const temporary = sessions.filter((session) => !session.saved && !session.busy && !session.titleBusy);
  const saved = sessions.filter((session) => session.saved && !session.busy && !session.titleBusy);
  const groups = [];
  if (running.length) groups.push({ label: tr("ai.runningSessions"), sessions: running });
  if (temporary.length) groups.push({ label: tr("ai.temporarySessions"), sessions: temporary });
  const savedByDate = new Map();
  saved.forEach((session) => {
    const label = `${tr("ai.savedSessions")} · ${getAiHistoryDateLabel(session.updatedAt)}`;
    if (!savedByDate.has(label)) savedByDate.set(label, []);
    savedByDate.get(label).push(session);
  });
  savedByDate.forEach((groupedSessions, label) => groups.push({ label, sessions: groupedSessions }));
  return groups;
}

function getAiHistoryDateLabel(timestamp) {
  const date = new Date(timestamp);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).getTime();
  if (startOfDate === startOfToday) return tr("ai.historyToday");
  if (startOfDate === yesterday) return tr("ai.historyYesterday");
  return tr("ai.historyEarlier");
}

function formatAiHistoryTime(timestamp) {
  return new Intl.DateTimeFormat(getCurrentLocale(), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
}

function formatAiSessionState(session) {
  if (session.busy || session.titleBusy) return tr("ai.running");
  return session.saved ? tr("ai.savedSession") : tr("ai.temporarySession");
}

async function runAiSessionMenuAction(action) {
  aiSessionMenuVisible.value = false;
  if (action === "compress") await compressAiContext();
  if (action === "reset") resetAiConversation();
  if (action === "delete") await deleteActiveAiSession();
}

async function generateAiSessionTitle() {
  const session = getActiveAiSession();
  if (session.busy || session.titleBusy || !session.messages.length) return;
  const model = session.agentModel.trim();
  try {
    validateAiConfig(model);
  } catch (error) {
    await showAlert(error.message || String(error), { tone: "danger" });
    return;
  }
  const controller = markRaw(new AbortController());
  session.titleBusy = true;
  session.titleAbortController = controller;
  try {
    const response = await callOpenAiResponses({
      model,
      store: false,
      instructions: "Create a concise, specific title for this coding-agent conversation. Return only the title, with no quotes, label, markdown, or trailing punctuation. Use the same language as the user's request and keep it within 80 characters.",
      input: buildAiSessionTitleContext(session),
      max_output_tokens: 64,
    }, controller.signal);
    const title = normalizeGeneratedAiSessionTitle(extractResponseText(response));
    if (!title) throw new Error(tr("ai.error.emptySessionName"));
    session.title = title;
    setStatus(tr("ai.sessionNameGenerated"), title);
  } catch (error) {
    if (error.name !== "AbortError") {
      setStatus(tr("status.aiError"), error.message || String(error));
      await showAlert(error.message || String(error), { tone: "danger" });
    }
  } finally {
    if (session.titleAbortController === controller) {
      session.titleBusy = false;
      session.titleAbortController = null;
    }
  }
}

function buildAiSessionTitleContext(session) {
  const context = session.messages
    .filter((message) => message.role !== "tool")
    .map((message) => `${message.role}: ${String(message.content || "")}`)
    .join("\n---\n");
  if (context.length <= 12000) return context;
  return `${context.slice(0, 6000)}\n---\n${context.slice(-6000)}`;
}

function normalizeGeneratedAiSessionTitle(value) {
  return String(value || "")
    .trim()
    .split(/\r?\n/, 1)[0]
    .replace(/^#+\s*/, "")
    .replace(/^(?:title|session title|会话名称)\s*[:：]\s*/i, "")
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, "")
    .replace(/[。.!！]+$/, "")
    .trim()
    .slice(0, 80);
}

async function deleteActiveAiSession() {
  if (aiBusy.value || !activeAiSession.value) return;
  await deleteAiSessionById(activeAiSessionId.value);
}

async function deleteAiSessionById(id) {
  const index = aiSessions.findIndex((session) => session.id === id);
  if (index === -1) return;
  const session = aiSessions[index];
  if (session.busy || session.titleBusy) return;
  const confirmed = await showConfirm(tr("confirm.deleteAiSession"), { title: tr("ai.deleteSession"), tone: "danger" });
  if (!confirmed) return;
  disposeAiMessageResources(session.messages);
  aiSessions.splice(index, 1);
  if (activeAiSessionId.value === id) {
    activeAiSessionId.value = aiSessions[Math.min(index, aiSessions.length - 1)]?.id || "";
    if (!activeAiSessionId.value) resetAiSessionDraft();
  }
  refreshAiTouchedFlags();
  touchDirtyState();
  setStatus(tr("ai.sessionDeleted"), "");
}

function addAiMessage(role, content, meta = {}, session = getActiveAiSession()) {
  session.messages.push(createAiMessage(role, content, meta));
  return session.messages.at(-1);
}

function createAiMessage(role, content, meta = {}) {
  return { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, role, content, ...meta };
}

function addPendingAiToolMessage(call, args, session, batchIndex, batchSize) {
  const reason = String(args?.reason || "").trim();
  const content = reason ? tr("ai.toolRunningReason", { reason }) : tr("ai.toolRunning");
  return addAiMessage("tool", content, {
    expanded: false,
    tool: { name: call.name, pending: true, cancelled: false, ok: null, args, result: null, batchIndex, batchSize },
  }, session);
}

function appendAiToolPurpose(summary, reason) {
  return reason ? `${summary}\n\n${tr("ai.toolPurpose", { reason })}` : summary;
}

function completeAiToolMessage(message, result) {
  if (message.tool.cancelled) return;
  message.content = result.summary || "";
  message.imagePreview = createAiImagePreview(result);
  if (!result.ok) message.expanded = true;
  message.tool.pending = false;
  message.tool.cancelled = false;
  message.tool.ok = Boolean(result.ok);
  message.tool.result = result;
}

function cancelAiToolMessage(message) {
  if (!message?.tool?.pending) return;
  const result = { ok: false, cancelled: true, summary: tr("ai.toolCancelled") };
  message.content = result.summary;
  message.tool.pending = false;
  message.tool.cancelled = true;
  message.tool.ok = false;
  message.tool.result = result;
}

function cancelPendingAiToolMessages(entries, startIndex = 0) {
  entries.slice(startIndex).forEach(({ message }) => cancelAiToolMessage(message));
}

function createAiAbortError() {
  return new DOMException(tr("status.aiStopped"), "AbortError");
}

function throwIfAiAborted(signal) {
  if (signal?.aborted) throw createAiAbortError();
}

function getActiveAiTouchedPaths(session = getActiveAiSession()) {
  return session.touchedPaths;
}

function markAiTouchedFile(file, session = getActiveAiSession()) {
  getActiveAiTouchedPaths(session).add(file.path);
  file.aiTouched = true;
}

function refreshAiTouchedFlags() {
  const touchedPaths = new Set();
  aiSessions.forEach((session) => session.touchedPaths.forEach((path) => touchedPaths.add(path)));
  openFiles.forEach((file) => { file.aiTouched = touchedPaths.has(file.path); });
}

function removeAiTouchedPath(path) {
  aiSessions.forEach((session) => session.touchedPaths.delete(path));
  refreshAiTouchedFlags();
}

function handleAiMessagesScroll() {
  const element = aiMessagesEl.value;
  if (!element) return;
  aiMessagesFollowOutput = element.scrollHeight - element.scrollTop - element.clientHeight <= AI_MESSAGES_BOTTOM_TOLERANCE_PX;
}

function handleAiMessagesWheel(event) {
  if (event.deltaY < 0) aiMessagesFollowOutput = false;
}

function scrollAiMessagesToBottom(force = false) {
  const element = aiMessagesEl.value;
  if (!element || (!force && !aiMessagesFollowOutput)) return;
  element.scrollTop = element.scrollHeight;
  aiMessagesFollowOutput = true;
}

function handleAiPromptKeydown(event) {
  if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
  event.preventDefault();
  sendAiPrompt();
}

async function handleAiAttachmentSelection(event) {
  const input = event.target;
  const files = Array.from(input.files || []);
  input.value = "";
  if (!files.length) return;
  const existingKeys = new Set(aiAttachments.value.map(getAiAttachmentFileKey));
  const additions = files.filter((file) => !existingKeys.has(getAiAttachmentFileKey(file)));
  try {
    if (aiAttachments.value.length + additions.length > AI_ATTACHMENT_MAX_COUNT) {
      throw new Error(tr("ai.error.tooManyAttachments", { count: AI_ATTACHMENT_MAX_COUNT }));
    }
    const normalized = additions.map(createAiAttachment);
    const totalSize = [...aiAttachments.value, ...normalized].reduce((total, attachment) => total + attachment.size, 0);
    if (totalSize > AI_ATTACHMENT_MAX_TOTAL_SIZE) {
      throw new Error(tr("ai.error.attachmentsTooLarge", { size: FileUtils.formatFileSize(AI_ATTACHMENT_MAX_TOTAL_SIZE) }));
    }
    aiAttachments.value.push(...normalized);
  } catch (error) {
    await showAlert(error.message || String(error), { tone: "danger" });
  }
}

function createAiAttachment(file) {
  const mimeType = String(file.type || getMimeType(file.name, "")).split(";", 1)[0].toLowerCase();
  const image = AI_ATTACHMENT_IMAGE_TYPES.has(mimeType);
  const text = FileUtils.isTextFile(file);
  if (!image && !text) throw new Error(tr("ai.error.unsupportedAttachment", { name: file.name }));
  const maxSize = image ? AI_IMAGE_MAX_FILE_SIZE : AI_TEXT_ATTACHMENT_MAX_FILE_SIZE;
  if (file.size > maxSize) {
    const key = image ? "ai.error.imageAttachmentTooLarge" : "ai.error.textAttachmentTooLarge";
    throw new Error(tr(key, { name: file.name, size: FileUtils.formatFileSize(maxSize) }));
  }
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: file.name,
    mimeType: mimeType || (image ? "image/png" : "text/plain"),
    size: file.size,
    lastModified: file.lastModified,
    kind: image ? "image" : "text",
    file: markRaw(file),
  };
}

function getAiAttachmentFileKey(value) {
  return `${value.name}\0${value.size}\0${value.lastModified || 0}`;
}

function removeAiAttachment(id) {
  if (aiBusy.value) return;
  const index = aiAttachments.value.findIndex((attachment) => attachment.id === id);
  if (index !== -1) aiAttachments.value.splice(index, 1);
}

function clearAiAttachments(attachments) {
  attachments.splice(0, attachments.length);
}

async function prepareAiAttachments(attachments) {
  return Promise.all(attachments.map(async (attachment) => {
    try {
      if (attachment.kind === "image") {
        const dataUrl = FileUtils.normalizeImageDataUrl(await FileUtils.readFileAsDataUrl(attachment.file), attachment.mimeType);
        return { ...attachment, dataUrl, file: undefined };
      }
      return { ...attachment, text: await attachment.file.text(), file: undefined };
    } catch {
      throw new Error(tr("ai.error.readAttachment", { name: attachment.name }));
    }
  }));
}

function formatJsonForDisplay(value) {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return String(value ?? "");
  }
}

function createAiImagePreview(result) {
  const path = result?.image_path;
  const file = path ? openFiles.get(path) : null;
  const blob = getActiveImageBlob(file);
  if (!blob) return null;
  return { path, objectUrl: URL.createObjectURL(blob), size: blob.size, mimeType: blob.type || file.mimeType };
}

function disposeAiMessageResources(messages) {
  (messages || []).forEach((message) => {
    if (message.imagePreview?.objectUrl) URL.revokeObjectURL(message.imagePreview.objectUrl);
  });
}

function registerInlineCompletions() {
  inlineCompletionDisposables.splice(0).forEach((disposable) => disposable.dispose());
  const languages = getEditorFeatureLanguageIds();
  languages.forEach((language) => {
    inlineCompletionDisposables.push(monaco.languages.registerInlineCompletionsProvider(language, {
      async provideInlineCompletions(model, position, context, token) {
        if (!settings.ai.apiKey.trim() || !settings.ai.completionModel.trim()) return { items: [] };
        const file = getFileByModel(model);
        if (!file) return { items: [] };
        if (context.triggerKind !== monaco.languages.InlineCompletionTriggerKind.Explicit) return { items: [] };
        abortAiCompletionRequest();
        const snapshot = getAiCompletionSnapshot(model, position);
        const requestId = ++aiCompletionRequestSerial;
        if (token?.isCancellationRequested || requestId !== aiCompletionRequestSerial || !isAiCompletionSnapshotCurrent(snapshot)) return { items: [] };
        if (aiCompletionInFlight) return { items: [] };
        const controller = new AbortController();
        aiCompletionAbortController = controller;
        aiCompletionInFlight = true;
        try {
          const insertText = await requestAiCompletion(file, model, position, controller.signal);
          if (token?.isCancellationRequested || requestId !== aiCompletionRequestSerial || !isAiCompletionSnapshotCurrent(snapshot) || !insertText.trim()) return { items: [] };
          return { items: [{ insertText, range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column) }] };
        } catch (error) {
          if (error.name !== "AbortError") console.warn("AI completion failed", error);
          return { items: [] };
        } finally {
          if (aiCompletionAbortController === controller) {
            aiCompletionAbortController = null;
            aiCompletionInFlight = false;
          }
        }
      },
      disposeInlineCompletions() {},
      freeInlineCompletions() {},
    }));
  });
}

function registerReferenceProviders() {
  referenceProviderDisposables.splice(0).forEach((disposable) => disposable.dispose());
  const languages = getEditorFeatureLanguageIds();
  languages.forEach((language) => {
    referenceProviderDisposables.push(monaco.languages.registerReferenceProvider(language, {
      provideReferences(model, position, context, token) {
        return provideWorkspaceReferences(model, position, token);
      },
    }));
  });
}

function getEditorFeatureLanguageIds() {
  const monacoLanguages = monaco?.languages?.getLanguages?.().map((language) => language.id) || [];
  return Array.from(new Set(["plaintext", ...languageOptions.map((item) => item.id), ...monacoLanguages]));
}

async function provideWorkspaceReferences(model, position, token) {
  const word = model.getWordAtPosition(position);
  if (!word?.word) return [];
  const fileNodes = collectFileNodes(tree.value, WORKSPACE_REFERENCE_FILE_LIMIT);
  const references = [];
  for (const node of fileNodes) {
    if (token?.isCancellationRequested) return [];
    const content = await readWorkspaceTextForNode(node, token);
    if (content === null) continue;
    const uri = getWorkspaceModelUri(node.path);
    let workspaceModel = monaco.editor.getModel(uri);
    let createdModel = false;
    if (!workspaceModel) {
      if (monaco.editor.getModels().length >= MONACO_MODEL_SOFT_LIMIT) break;
      workspaceModel = getOrCreateWorkspaceModel(content, getMonacoLanguageId(getLanguageId(node.name)), node.path, true);
      createdModel = true;
    }
    const referenceCount = references.length;
    const matches = workspaceModel.findMatches(word.word, false, false, true, null, false, WORKSPACE_REFERENCE_RESULT_LIMIT - references.length);
    matches.forEach((match) => {
      if (isExactWordMatch(workspaceModel, match.range, word.word)) references.push({ uri: workspaceModel.uri, range: match.range });
    });
    if (createdModel) {
      if (references.length > referenceCount) workspaceModelPaths.add(node.path);
      else workspaceModel.dispose();
    }
    if (references.length >= WORKSPACE_REFERENCE_RESULT_LIMIT) break;
  }
  return references;
}

function isExactWordMatch(model, range, word) {
  const matchWord = model.getWordAtPosition({ lineNumber: range.startLineNumber, column: range.startColumn });
  return matchWord?.word === word && matchWord.startColumn === range.startColumn && matchWord.endColumn === range.endColumn;
}

function registerCompletionInvalidation() {
  inlineCompletionDisposables.push(editor.value.onDidChangeModelContent(invalidateAiCompletionRequest));
  inlineCompletionDisposables.push(editor.value.onDidChangeCursorPosition(invalidateAiCompletionRequest));
}

function invalidateAiCompletionRequest() {
  aiCompletionRequestSerial += 1;
  abortAiCompletionRequest();
}

function abortAiCompletionRequest() {
  if (!aiCompletionAbortController) return;
  aiCompletionRequestSerial += 1;
  aiCompletionAbortController.abort();
  aiCompletionAbortController = null;
  aiCompletionInFlight = false;
}

function getAiCompletionSnapshot(model, position) {
  return { model, versionId: model.getVersionId(), lineNumber: position.lineNumber, column: position.column };
}

function isAiCompletionSnapshotCurrent(snapshot) {
  const position = editor.value?.getPosition();
  return editor.value?.getModel() === snapshot.model
    && snapshot.model.getVersionId() === snapshot.versionId
    && position?.lineNumber === snapshot.lineNumber
    && position?.column === snapshot.column;
}

async function requestAiCompletion(file, model, position, signal) {
  validateAiConfig(settings.ai.completionModel.trim());
  const value = model.getValue();
  const offset = model.getOffsetAt(position);
  const prefixChars = AI_COMPLETION_MANUAL_PREFIX_CHARS;
  const suffixChars = AI_COMPLETION_MANUAL_SUFFIX_CHARS;
  const prefix = value.slice(Math.max(0, offset - prefixChars), offset);
  const suffix = value.slice(offset, Math.min(value.length, offset + suffixChars));
  const response = await callOpenAiResponses({
    model: settings.ai.completionModel.trim(),
    store: false,
    reasoning: { effort: "low" },
    text: { verbosity: "low" },
    instructions: "You are a code completion engine. Return only the missing text to insert at <CURSOR>. Do not repeat existing code before or after the cursor. Do not output the whole function/class/block when only a part is missing. No markdown.",
    input: `File: ${file.path}\nLanguage: ${file.language}\n\n${prefix}<CURSOR>${suffix}`,
    max_output_tokens: AI_COMPLETION_MANUAL_MAX_OUTPUT_TOKENS,
  }, signal);
  const text = extractResponseText(response).replace(/^```[\w-]*\n?/, "").replace(/```$/, "");
  const meta = response.__meta;
  if (meta) setStatus(tr("status.aiCompletion"), `${meta.ms}ms · ${(meta.bytes / 1024).toFixed(1)}KB`);
  return text;
}

async function sendAiPrompt() {
  let session = activeAiSession.value;
  const creatingSession = !session;
  const rawPrompt = aiPrompt.value.trim();
  const selectedAttachments = [...aiAttachments.value];
  if ((!rawPrompt && !selectedAttachments.length) || session?.busy) return;
  const prompt = rawPrompt || tr("ai.attachmentOnlyPrompt");
  const model = aiSessionAgentModel.value.trim();
  const reasoningEffort = aiSessionReasoningEffort.value;
  try {
    validateAiConfig(model);
  } catch (error) {
    if (session) addAiMessage("assistant", error.message, {}, session);
    else await showAlert(error.message || String(error), { tone: "danger" });
    return;
  }
  let preparedAttachments;
  try {
    preparedAttachments = await prepareAiAttachments(selectedAttachments);
  } catch (error) {
    await showAlert(error.message || String(error), { tone: "danger" });
    return;
  }
  if (creatingSession) {
    session = createAiSession({
      title: aiSessionDraft.title,
      agentModel: model,
      reasoningEffort,
      saved: aiSessionDraft.saved,
    });
  }
  session.prompt = "";
  session.busy = true;
  addAiMessage("user", formatAiUserMessage(prompt, preparedAttachments), {}, session);
  if (creatingSession) {
    aiSessions.push(session);
    activeAiSessionId.value = session.id;
    session = aiSessions.find((item) => item.id === session.id);
    resetAiSessionDraft();
    setStatus(tr("ai.sessionCreated"), session.title);
  } else {
    clearAiAttachments(session.pendingAttachments);
  }
  const controller = markRaw(new AbortController());
  session.abortController = controller;
  try {
    await runAiAgent(prompt, controller.signal, session, { model, reasoningEffort, attachments: preparedAttachments });
    setStatus(tr("status.aiCompleted"), model);
  } catch (error) {
    if (error.name === "AbortError") {
      addAiMessage("assistant", tr("status.aiStopped"), {}, session);
      setStatus(tr("status.aiStopped"), "");
    } else {
      addAiMessage("assistant", error.message || String(error), {}, session);
      setStatus(tr("status.aiError"), error.message || String(error));
    }
  } finally {
    if (session.abortController === controller) {
      session.busy = false;
      session.abortController = null;
    }
  }
}

function stopAiTask() {
  const session = activeAiSession.value;
  session?.abortController?.abort();
  session?.titleAbortController?.abort();
  session?.messages.forEach(cancelAiToolMessage);
  void nextTick(scrollAiMessagesToBottom);
}

function resetAiConversation() {
  if (aiBusy.value || !canResetAiConversation.value) return;
  const session = activeAiSession.value;
  if (!session) {
    resetAiSessionDraft();
    setStatus(tr("ai.conversationReset"), "");
    return;
  }
  aiPrompt.value = "";
  disposeAiMessageResources(session.messages);
  session.messages.splice(0, session.messages.length);
  clearAiAttachments(session.pendingAttachments);
  session.touchedPaths.clear();
  session.contextUsage = null;
  session.title = tr("ai.defaultSessionTitle", { count: aiSessions.indexOf(session) + 1 });
  refreshAiTouchedFlags();
  touchDirtyState();
  setStatus(tr("ai.conversationReset"), "");
}

async function compressAiContext() {
  const session = getActiveAiSession();
  if (session.busy || !session.messages.length) return;
  const model = session.agentModel.trim();
  try {
    validateAiConfig(model);
  } catch (error) {
    addAiMessage("assistant", error.message, {}, session);
    return;
  }
  const controller = markRaw(new AbortController());
  session.abortController = controller;
  session.busy = true;
  const beforeLength = formatAiUsage(session.contextUsage);
  const touchedPaths = getActiveAiTouchedPaths(session);
  try {
    const payload = {
      model,
      store: false,
      instructions: "Compress the provided AI assistant conversation into a concise but complete context summary for future coding-agent turns. Preserve user goals, decisions, file paths, tool results, pending unsaved changes, AI-created files, deleted/pending-delete files, and unresolved issues. Do not add markdown fences.",
      input: `Workspace: ${rootName.value || "unknown"}\nAI-touched files: ${formatFileStateList(getAiTouchedFiles(session), { touchedPaths })}\nDirty files: ${formatFileStateList(dirtyFiles.value, { touchedPaths })}\n\nConversation to compress:\n${formatRecentAiMessages({ includePendingUserMessage: true, session })}`,
      max_output_tokens: 4096,
    };
    if (session.reasoningEffort && session.reasoningEffort !== "default") payload.reasoning = { effort: session.reasoningEffort };
    const response = await callOpenAiResponses(payload, controller.signal);
    updateAiContextUsage(response, session);
    const summary = extractResponseText(response);
    if (!summary) throw new Error("Empty compressed context");
    disposeAiMessageResources(session.messages);
    session.messages.splice(0, session.messages.length, createAiMessage("assistant", `# ${tr("ai.contextSummaryTitle")}\n\n${summary}`));
    await nextTick();
    setStatus(tr("ai.contextCompressed"), `${beforeLength} -> ${formatAiUsage(session.contextUsage)}`);
  } catch (error) {
    if (error.name === "AbortError") {
      setStatus(tr("status.aiStopped"), "");
    } else {
      addAiMessage("assistant", error.message || String(error), {}, session);
      setStatus(tr("status.aiError"), error.message || String(error));
    }
  } finally {
    if (session.abortController === controller) {
      session.busy = false;
      session.abortController = null;
    }
  }
}

async function runAiAgent(prompt, signal, session = getActiveAiSession(), runConfig = {}) {
  const conversation = buildAgentInputMessages(prompt, session, runConfig.attachments);
  const agentInstructions = getAgentInstructions();
  const model = runConfig.model || session.agentModel.trim();
  const reasoningEffort = runConfig.reasoningEffort || session.reasoningEffort;
  for (let round = 0; round < AI_AGENT_MAX_TOOL_CALL_ROUNDS; round += 1) {
    const payload = { model, instructions: agentInstructions, input: conversation, tools: getAiToolDefinitions() };
    if (reasoningEffort && reasoningEffort !== "default") payload.reasoning = { effort: reasoningEffort };
    const response = await callOpenAiResponses(payload, signal);
    updateAiContextUsage(response, session);
    const text = extractResponseText(response);
    if (text) addAiMessage("assistant", text, {}, session);
    const toolCalls = extractFunctionCalls(response);
    if (!toolCalls.length) return;
    conversation.push(...getContinuationOutputItems(response));
    const imageInputs = [];
    const parsedToolCalls = toolCalls.map((call) => ({ call, args: parseAiToolArguments(call) }));
    const pendingToolCalls = parsedToolCalls.map(({ call, args }, index) => ({ call, args, message: addPendingAiToolMessage(call, args, session, index + 1, parsedToolCalls.length) }));
    await nextTick();
    scrollAiMessagesToBottom();
    for (let index = 0; index < pendingToolCalls.length; index += 1) {
      if (signal.aborted) {
        cancelPendingAiToolMessages(pendingToolCalls, index);
        await nextTick();
        scrollAiMessagesToBottom();
        throw createAiAbortError();
      }
      const { call, args, message } = pendingToolCalls[index];
      try {
        const result = call.name === "read_image"
          ? await runAiReadImageToolCall(args, imageInputs)
          : await runAiToolCall(call, args, session, signal);
        throwIfAiAborted(signal);
        completeAiToolMessage(message, result);
        conversation.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) });
      } catch (error) {
        if (error.name !== "AbortError" && !signal.aborted) throw error;
        cancelAiToolMessage(message);
        cancelPendingAiToolMessages(pendingToolCalls, index + 1);
        await nextTick();
        scrollAiMessagesToBottom();
        throw error.name === "AbortError" ? error : createAiAbortError();
      }
      await nextTick();
      scrollAiMessagesToBottom();
      if (signal.aborted) {
        cancelPendingAiToolMessages(pendingToolCalls, index + 1);
        await nextTick();
        scrollAiMessagesToBottom();
        throw createAiAbortError();
      }
    }
    if (imageInputs.length) conversation.push(buildImageInputMessage(imageInputs));
  }
  addAiMessage("assistant", "Reached the tool-call round limit. Review the current changes before continuing.", {}, session);
}

async function runAiReadImageToolCall(args, imageInputs) {
  try {
    const image = await aiToolReadImage(args.path);
    imageInputs.push(image);
    return {
      ok: true,
      summary: `Attached image ${image.path} to the next model turn`,
      path: image.path,
      mime_type: image.mimeType,
      size: image.size,
    };
  } catch (error) {
    if (error.name === "AbortError") throw error;
    return { ok: false, summary: error.message || String(error) };
  }
}

function buildImageInputMessage(images) {
  const content = [];
  images.forEach((image) => {
    content.push({ type: "input_text", text: `Image attached from read_image: ${image.path}` });
    content.push({ type: "input_image", image_url: image.dataUrl, detail: "auto" });
  });
  return { role: "user", content };
}

function getContinuationOutputItems(response) {
  return (response.output || []).flatMap((item) => {
    if (item.type === "function_call" && item.name) {
      return [compactObject({ type: "function_call", id: item.id, call_id: item.call_id, name: item.name, arguments: item.arguments || "{}", status: item.status })];
    }
    if (item.type === "message") {
      const content = (item.content || []).flatMap((part) => {
        if (part.type === "output_text") return [compactObject({ type: "output_text", text: part.text, annotations: part.annotations, logprobs: part.logprobs })];
        if (part.type === "refusal") return [compactObject({ type: "refusal", refusal: part.refusal })];
        return [];
      });
      return [compactObject({ type: "message", id: item.id, role: item.role || "assistant", content, status: item.status })];
    }
    return [];
  });
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function getAgentInstructions() {
  const instructions = [
    "You are an autonomous coding assistant inside a browser-based Monaco editor.",
    "You run in a browser sandbox, not on the user's local machine. Be accurate about what you can and cannot access.",
    getBrowserRegionalContextInstruction(),
    "Be concise, direct, and answer the user's request without unnecessary preamble or postamble.",
    "Before changing code, understand the surrounding conventions and follow the existing style, patterns, naming, and libraries.",
    "Do not assume a library or framework is available just because it is common; rely on what the project already uses.",
    "Follow security best practices. Never introduce code that exposes, logs, or commits secrets, keys, or credentials.",
    "Do not add code comments unless they are needed to explain non-obvious behavior or the user asks for them.",
    "When multiple independent tool calls are needed and their inputs are already known, issue those tool calls together in the same response instead of one per round. Prefer batch tools when available to reduce latency and token usage.",
    "Use tools only when they are necessary. If a tool result is sufficient to answer the request, stop calling more tools and answer from that result. Do not retry with alternate URLs, formats, or sources just to confirm information that is already clear.",
    "When using tools, make focused calls, request the smallest output that can answer the user, and explicitly set available output limits for simple lookups or large-result tools. Keep output limits as small as possible while still completing the task to avoid bloating context.",
    "Choose an execution environment from the user's requested target and keep that boundary throughout the task. A failure in one environment does not grant permission to move execution to another environment. Remote-host tools are only for tasks that explicitly target a configured remote host or inherently depend on that host's state.",
    "Never claim something changed unless you have confirmed it through the available context.",
    "Resolve references like 'the file you created' from Recent chat and AI-touched files before using the current editor file. If multiple files match, ask a short clarification instead of editing or deleting the current file by default.",
    "Prefer small, targeted edits. Explain changed files briefly; do not paste whole modified files in chat.",
  ];
  const agentsMd = getRootAgentsMdContent();
  if (agentsMd) instructions.push(formatAgentsMdInstructions(agentsMd));
  return instructions.join(" ");
}

function getBrowserRegionalContextInstruction() {
  const now = new Date();
  const resolved = Intl.DateTimeFormat().resolvedOptions();
  const offsetMinutes = -now.getTimezoneOffset();
  const offsetSign = offsetMinutes >= 0 ? "+" : "-";
  const offsetHours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, "0");
  const offsetRemainder = String(Math.abs(offsetMinutes) % 60).padStart(2, "0");
  const languages = Array.from(new Set([...(navigator.languages || []), navigator.language].filter(Boolean)));
  return `Current browser regional context: local time ${now.toLocaleString()}; UTC time ${now.toISOString()}; time zone ${resolved.timeZone || "unknown"}; UTC offset ${offsetSign}${offsetHours}:${offsetRemainder}; locale ${resolved.locale || navigator.language || "unknown"}; preferred languages ${languages.join(", ") || "unknown"}. These browser-derived values are approximate regional hints, not precise geolocation.`;
}

function getRootAgentsMdContent() {
  dirtyRevision.value;
  const opened = openFiles.get(AI_AGENTS_FILE_NAME);
  if (isTextFileState(opened)) return opened.model.getValue();
  return agentsMdContent.value;
}

async function readRootAgentsMdFromDisk(workspace = captureWorkspace()) {
  if (!workspace.session) return "";
  try {
    const entry = await workspace.session.stat(AI_AGENTS_FILE_NAME);
    if (!isReadableTextEntry(entry)) return "";
    return await workspace.session.readText(AI_AGENTS_FILE_NAME);
  } catch (error) {
    if (error?.code === "FILE_NOT_FOUND") return "";
    console.warn(`Failed to load ${AI_AGENTS_FILE_NAME}:`, error);
    return "";
  }
}

function formatAgentsMdInstructions(content) {
  const text = String(content || "").trim();
  if (!text) return "";
  const truncated = text.length > AI_AGENTS_MAX_CHARS;
  return [
    `Additional workspace instructions from root ${AI_AGENTS_FILE_NAME}:`,
    truncated ? text.slice(0, AI_AGENTS_MAX_CHARS) : text,
    truncated ? `[${AI_AGENTS_FILE_NAME} truncated to ${AI_AGENTS_MAX_CHARS} characters]` : "",
  ].filter(Boolean).join("\n");
}

function buildAgentInputMessages(prompt, session = getActiveAiSession(), attachments = []) {
  return [
    { role: "user", content: buildAgentWorkspaceContext() },
    ...buildAgentRecentChatMessages(session),
    { role: "user", content: buildAgentTouchedFilesContext(session) },
    buildAgentRequestInputMessage(prompt, session, attachments),
  ];
}

function buildAgentRequestInputMessage(prompt, session, attachments) {
  const requestContext = buildAgentRequestContext(prompt, session);
  if (!attachments?.length) return { role: "user", content: requestContext };
  const content = [{ type: "input_text", text: requestContext }];
  attachments.forEach((attachment) => {
    const description = `Local attachment: ${attachment.name} (${attachment.mimeType || "unknown"}, ${attachment.size} bytes)`;
    if (attachment.kind === "image") {
      content.push({ type: "input_text", text: description });
      content.push({ type: "input_image", image_url: attachment.dataUrl, detail: "auto" });
    } else {
      content.push({ type: "input_text", text: `${description}\n\n${attachment.text}` });
    }
  });
  return { role: "user", content };
}

function formatAiUserMessage(prompt, attachments) {
  if (!attachments?.length) return prompt;
  return `${prompt}\n\n${tr("ai.attachmentsSummary", { names: attachments.map((attachment) => attachment.name).join(", ") })}`;
}

function buildAgentWorkspaceContext() {
  const workspaceLoaded = isWorkspaceLoaded();
  const backendEnabled = isBackendEnabled();
  const sshConnections = getAiExposedSshConfigs();
  return [
    "Workspace context:",
    `Workspace: ${rootName.value || "unknown"}`,
    `Workspace loaded: ${workspaceLoaded ? "yes" : "no"}`,
    `Backend enabled: ${backendEnabled ? "yes" : "no"}`,
    `SSH exposed count: ${sshConnections.length}`,
    "Tool requirement status:",
    ...formatAiRequirementStatusLines(),
    `${AI_AGENTS_FILE_NAME}: ${getRootAgentsMdContent() ? "loaded" : "not loaded"}`,
    `Locale: ${getCurrentLocale()}`,
  ].join("\n");
}

function formatAiRequirementStatusLines() {
  return ["workspace", "backend", "ssh_exposed"].map((requirement) => {
    const status = getAiRequirementStatus(requirement);
    return `- ${requirement}: ${status.met ? "available" : `unavailable (${status.reason})`}`;
  });
}

function buildAgentRecentChatMessages(session = getActiveAiSession()) {
  const messages = getRecentAiHistoryMessages({ session });
  if (!messages.length) return [{ role: "user", content: "Recent chat:\nnone" }];
  return [
    { role: "user", content: "Recent chat messages follow as separate input messages." },
    ...messages.map((message, index) => ({ role: message.role === "assistant" ? "assistant" : "user", content: `Recent chat ${index + 1} (${message.role}):\n${String(message.content || "")}` })),
  ];
}

function buildAgentTouchedFilesContext(session = getActiveAiSession()) {
  const touchedPaths = getActiveAiTouchedPaths(session);
  return [
    "AI-touched files:",
    formatFileStateList(getAiTouchedFiles(session), { touchedPaths }),
  ].join("\n");
}

function buildAgentRequestContext(prompt, session = getActiveAiSession()) {
  const current = activeFile.value ? `${activeFile.value.path} (${activeFile.value.language})` : "none";
  const touchedPaths = getActiveAiTouchedPaths(session);
  return [
    "Current request context:",
    `Current file: ${current}`,
    `Open files: ${openFileList.value.map((file) => file.path).join(", ") || "none"}`,
    `Dirty files: ${formatFileStateList(dirtyFiles.value, { touchedPaths })}`,
    `User request:\n${prompt}`,
  ].join("\n");
}

function getAiTouchedFiles(session = getActiveAiSession()) {
  dirtyRevision.value;
  const touchedPaths = getActiveAiTouchedPaths(session);
  return Array.from(openFiles.values()).filter((file) => touchedPaths.has(file.path));
}

function formatFileStateList(files, options = {}) {
  if (!files.length) return "none";
  const touchedPaths = options.touchedPaths || getActiveAiTouchedPaths();
  return files.map((file) => {
    const flags = [file.isNew ? "new" : "", file.deleted ? "pending-delete" : "", file.dirty ? "dirty" : "", touchedPaths.has(file.path) ? "ai-touched" : ""].filter(Boolean).join(",");
    return flags ? `${file.path} [${flags}]` : file.path;
  }).join(", ");
}

function formatRecentAiMessages(options = {}) {
  const history = getRecentAiHistoryMessages(options);
  if (!history.length) return "none";
  return history.map((message) => `${message.role}: ${String(message.content || "")}`).join("\n---\n");
}

function getRecentAiHistoryMessages(options = {}) {
  const messages = options.session?.messages || aiMessages.value;
  return options.includePendingUserMessage ? messages : messages.slice(0, -1);
}

function updateAiContextUsage(response, session = getActiveAiSession()) {
  const usage = normalizeAiUsage(response?.usage);
  if (usage) session.contextUsage = usage;
}

function normalizeAiUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const input = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0);
  const output = Number(usage.output_tokens ?? usage.completion_tokens ?? 0);
  const total = Number(usage.total_tokens ?? input + output);
  const rawCached = usage.input_tokens_details?.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? usage.cached_tokens;
  const cached = Number(rawCached ?? 0);
  if (![input, output, total].some((value) => Number.isFinite(value) && value > 0)) return null;
  return {
    input: Number.isFinite(input) ? input : 0,
    output: Number.isFinite(output) ? output : 0,
    total: Number.isFinite(total) ? total : 0,
    cached: Number.isFinite(cached) ? cached : 0,
    hasCache: rawCached != null,
  };
}

function formatAiUsage(usage) {
  if (!usage) return tr("ai.usageNotMeasured");
  const cacheRate = usage.input > 0 && usage.cached > 0 ? Math.round((usage.cached / usage.input) * 100) : 0;
  const cache = cacheRate ? tr("ai.usageCache", { cached: usage.cached, rate: cacheRate }) : (usage.hasCache ? tr("ai.usageCacheMiss") : "");
  return tr("ai.usageMeasured", {
    input: usage.input,
    output: usage.output,
    total: usage.total,
    cache,
  });
}

function getAiToolDefinitions() {
  return getAiAllToolDefinitions()
    .map(stripAiToolInternalMetadata);
}

function getAiAllToolDefinitions() {
  const reasonLanguage = getCurrentLocale() === "zh-CN" ? "Chinese" : "English";
  return [
    { type: "function", name: "get_tool_availability", description: aiToolDescription(
      "Check current AI tool availability and requirement status.",
      "Use this when you are unsure whether workspace, backend, SSH, or SFTP related tools are currently usable. This tool does not return parameter schemas; use each tool's own description and parameters directly.",
      "All tools are visible to you, but tools with unmet requirements will fail if called. Prefer checking availability before using tools that depend on workspace, backend, or exposed SSH settings."
    ), parameters: { type: "object", properties: { names: { type: "array", items: { type: "string" }, description: "Optional tool names to check. Omit to return all tools." } } } },
    { type: "function", name: "load_credentials", requirements: ["workspace"], description: aiToolDescription(
      "Load single-line KEY=VALUE credentials from a workspace text file.",
      "Credential values are kept in memory. Later loads override earlier values with the same Key. The result returns Key names and source paths, never values."
    ), parameters: { type: "object", properties: { path: { type: "string", description: "Workspace-relative credential file path." } }, required: ["path"] } },
    { type: "function", name: "list_credentials", requirements: ["workspace"], description: aiToolDescription(
      "List the currently active credential Keys and their source files.",
      "Credential values are never returned."
    ), parameters: { type: "object", properties: {} } },
    { type: "function", name: "run_javascript", description: aiToolDescription(
      "Execute a complete JavaScript program in an isolated browser Worker for computation, data transformation, network requests, and declared workspace file processing. The runtime implements a documented subset of Node.js APIs, not a complete Node.js environment. Do not assume that an unlisted module or method is available.",
      "Choose an explicit format for generated code instead of relying on inference. CommonJS uses require() and module.exports; generated async CommonJS must execute and export its entry Promise with module.exports = main() so the task runs and is awaited. Do not use module.exports = main or module.exports = async () => {...}; those forms only export a function without executing the task. ESM uses import, export, and top-level await; use export default await main() when returning one async result. UMD returns module.exports when available, otherwise its detected global export. A global script must expose returned values through globalThis.",
      "Do not mix CommonJS and ESM syntax. CommonJS does not support import(). ESM dynamic import() accepts only a string literal. Every require(), static import, and dynamic import() that must be prepared before execution must use a direct string literal, not a variable, template literal, or concatenated string. Do not catch and ignore entry errors. Handle an error only when the script can recover; otherwise let it reject or throw. To mark an explicit failure, set a nonzero process.exitCode or call process.exit() with a nonzero code.",
      "If a package's ESM graph fails specifically with UNSUPPORTED_ESM_CYCLE and the package also exports CommonJS, retry that package with format commonjs and require(). Do not switch formats for unrelated syntax, dependency, or runtime errors.",
      "Relative modules, JSON, workspace node_modules, npm Registry packages, and HTTP/HTTPS modules are supported. Workspace code should use ordinary bare package names and declare Registry packages missing from the workspace through dependencies. Runtime-specific npm: and direct HTTP/HTTPS module specifiers are for temporary inline code and should not be written into workspace files unless the user explicitly requests that format. Prefer version-pinned, browser-compatible packages with small dependency trees. For small tasks, prefer a pinned single-file CDN build; use an npm package when its complete module or resource set is needed. Do not assume that an arbitrary npm entry point works in a browser Worker.",
      [
        "Dependency usage examples:",
        "1. Workspace relative modules:",
        "CommonJS: const helper = require(\"./helper.js\"); const config = require(\"./config.json\"); module.exports = helper(config);",
        "ESM: import helper from \"./helper.js\"; import config from \"./config.json\"; export default helper(config);",
        "Relative paths resolve from the importing module. For inline code, they resolve from resolve_from.",
        "2. Packages already present in workspace node_modules:",
        "CommonJS: const lodash = require(\"lodash\"); module.exports = lodash.chunk(input.values, 2);",
        "ESM: import lodash from \"lodash\"; export default lodash.chunk(input.values, 2);",
        "The runtime searches workspace node_modules using Node.js upward resolution; do not also declare an installed package in dependencies.",
        "3. Download a missing npm Registry package by using a bare import in source and passing a pinned package root through dependencies:",
        "CommonJS arguments: {\"format\":\"commonjs\",\"code\":\"const jpeg = require(\\\"jpeg-js\\\"); module.exports = typeof jpeg.encode;\",\"dependencies\":[\"jpeg-js@0.4.4\"]}",
        "ESM arguments: {\"format\":\"module\",\"code\":\"import jpeg from \\\"jpeg-js\\\"; export default typeof jpeg.encode;\",\"dependencies\":[\"jpeg-js@0.4.4\"]}",
        "Scoped subpath arguments: {\"format\":\"module\",\"code\":\"import value from \\\"@scope/package/subpath\\\"; export default value;\",\"dependencies\":[\"@scope/package@1.2.3\"]}",
        "dependencies accepts package roots only. Put a package subpath in the source import, not in dependencies.",
        "4. Inline code may use an npm: specifier directly:",
        "CommonJS: const jpeg = require(\"npm:jpeg-js@0.4.4\"); module.exports = typeof jpeg.encode;",
        "ESM: import jpeg from \"npm:jpeg-js@0.4.4\"; export default typeof jpeg.encode;",
        "Scoped subpath: const feature = require(\"npm:@scope/package@1.2.3/subpath\");",
        "5. CommonJS loading a pinned cdnjs single-file build:",
        "const dayjs = require(\"https://cdnjs.cloudflare.com/ajax/libs/dayjs/1.11.13/dayjs.min.js\"); module.exports = dayjs(\"2026-07-26\").format(\"YYYY/MM/DD\");",
        "cdnjs commonly serves UMD or global browser builds whose exports the runtime attempts to detect. Use a concrete versioned file URL, not latest.",
        "6. ESM loading a pinned jsDelivr npm file:",
        "import { nanoid } from \"https://cdn.jsdelivr.net/npm/nanoid@5.1.5/index.browser.js\"; export default nanoid(12);",
        "Prefer an entry explicitly intended for ESM or browsers.",
        "7. ESM loading esm.sh:",
        "import dayjs from \"https://esm.sh/dayjs@1.11.13\"; export default dayjs(\"2026-07-26\").format(\"YYYY/MM/DD\");",
        "8. HTTP modules:",
        "CommonJS: const library = require(\"https://example.com/library/index.js\"); module.exports = library.run(input);",
        "ESM: import library from \"https://example.com/library/index.mjs\"; export default await library.run(input);",
        "A remote module's relative dependencies resolve recursively against that module's URL.",
        "9. ESM string-literal dynamic import:",
        "const module = await import(\"https://cdn.jsdelivr.net/npm/nanoid@5.1.5/index.browser.js\"); export default module.nanoid(12);",
        "Do not pass a variable to import(). Switch CommonJS code that needs dynamic import to ESM.",
      ].join("\n"),
      "The virtual file system is rooted at the workspace. Module-relative paths resolve from the importing module, inline module-relative paths resolve from resolve_from, and relative node:fs paths resolve from cwd. Workspace modules referenced by static import or require are loaded automatically. Declare only ordinary data files read through node:fs or node:fs/promises in input_files. Scripts may create temporary files, but only changed files within output_files and output_directories are extracted; every other temporary file is discarded. Extracted files are staged in the editor and reach disk only when the user saves them. File deletion and empty-directory output are unsupported.",
      "node:fs exposes promises, readFileSync, writeFileSync, statSync, existsSync, readdirSync, readFile, writeFile, createWriteStream, and a compatibility-only recursive mkdirSync; writes create missing parents automatically. node:fs/promises exposes access, readFile, writeFile, stat, readdir, mkdir, unlink, and rm. Do not use rename, createReadStream, file watchers, permission changes, file-descriptor operations, or other unlisted filesystem APIs.",
      [
        "Supported built-ins (the same names without node: are accepted as aliases):",
        "- Core and data: node:assert, node:assert/strict, node:buffer, node:cluster, node:events, node:path, node:path/posix, node:process, node:punycode, node:querystring, node:string_decoder, node:tty, node:url, node:util, and node:util/types.",
        "- Files and network: node:fs, node:fs/promises, node:http, and node:https.",
        "- Streams, timers, and compression: node:stream, node:stream/promises, node:stream/web, node:timers, node:timers/promises, and node:zlib.",
        "- Cryptography APIs: node:crypto exposes webcrypto, subtle, getRandomValues, randomBytes, randomFill, randomFillSync, randomInt, randomUUID, createHash, createHmac, timingSafeEqual, PBKDF2, HKDF, scrypt, createCipheriv, createDecipheriv, and createECDH.",
        "- Hash algorithms: md5, sha1, sha224, sha256, sha384, sha512, sha512-224, sha512-256, sha3-224/256/384/512, shake128, shake256, ripemd160, blake2b512, and blake2s256. MD5 and SHA-1 are provided only for legacy compatibility and should not be used for new security-sensitive work.",
        "- Cipher and ECDH algorithms: AES-128/192/256 in CBC, CTR, CFB, ECB, and GCM modes; ChaCha20-Poly1305; and ECDH curves prime256v1, secp256k1, secp384r1, and secp521r1. Cipher update() buffers input and final() returns the result. Authenticated ciphers support only 16-byte tags, AES-GCM IVs must be at least 8 bytes, scrypt maxmem is capped at 64 MiB, and symmetric CryptoKey/KeyObject inputs are unsupported.",
        "node:process is limited to argv, env, cwd(), exit(), exitCode, and nextTick(). node:cluster exposes single-process primary-state metadata and event APIs for package-loading compatibility; creating worker processes and cluster IPC are unsupported. node:tty provides isatty() and reports false because the Worker has no terminal. node:http provides METHODS, STATUS_CODES, header validation, and minimal get/request; node:https provides only minimal get/request. Prefer fetch, and do not use setEncoding, resume, Agent, sockets, or connection-pool APIs. node:zlib supports buffered deflate/inflate, raw deflate/inflate, gzip/gunzip, and unzip APIs but not Brotli or full native streaming semantics.",
        "Unsupported Node features include child_process, os, worker_threads, net, tls, dns, native extensions, RSA/DSA signing, PEM/KeyObject/certificate APIs, CommonJS import(), variable dynamic imports, and cyclic ESM dependencies.",
      ].join("\n"),
      "During execution, fetch, XMLHttpRequest, node:http, and node:https share request-count, per-response-size, cumulative-download-size, and timeout limits. Requests use RequestProxy when the backend is available and otherwise use the browser network directly, which may still be blocked by CORS, DNS, TLS, or browser security policy. proxy_options.use_target_origin and proxy_options.use_target_referer make the backend synthesize source headers from each target URL. Do not set either option unless the user explicitly requests it; never enable them automatically to retry a failed, CORS-blocked, or XSRF-rejected request.",
      [
        "Runtime limits not represented directly by parameter schemas:",
        `- dependency preparation: up to ${AI_JAVASCRIPT_MAX_PREPARE_REQUEST_COUNT} requests and a cumulative download budget independent from execution`,
        `- script fetch, XMLHttpRequest, node:http, and node:https: up to ${AI_JAVASCRIPT_MAX_REQUEST_COUNT} requests in total`,
        `- prepared virtual file system, including inputs, entry source, modules, and extracted packages: up to ${normalizeMemoryLimit(settings.maxMemoryReadBytes, DEFAULT_MAX_MEMORY_READ_BYTES)} bytes in total`,
        `- each input and network response: up to ${normalizeMemoryLimit(settings.maxMemoryReadBytes, DEFAULT_MAX_MEMORY_READ_BYTES)} bytes; preparation and execution each receive their own cumulative download budget of the same size`,
        `- each output and all outputs combined: up to ${normalizeMemoryLimit(settings.maxMemoryWriteBytes, DEFAULT_MAX_MEMORY_WRITE_BYTES)} bytes`,
        `- console output: up to ${AI_JAVASCRIPT_MAX_LOGS} log entries`,
        `- structured result collections: up to ${AI_JAVASCRIPT_MAX_RESULT_COLLECTION_ITEMS} entries each and ${AI_JAVASCRIPT_MAX_RESULT_DEPTH} levels deep`,
      ].join("\n"),
      `You must provide reason as one short sentence explaining what the script is intended to do. Write reason in ${reasonLanguage} to match the current interface language.`,
      "A successful call returns the script result, logs, and staged files. A failure returns ok: false with a structured error. Always check ok; logs or partially created temporary files do not mean that execution succeeded."
    ), parameters: { type: "object", properties: {
      reason: { type: "string", description: `Required short explanation of what this JavaScript execution is intended to do. Write it in ${reasonLanguage}.` },
      code: { type: "string", maxLength: AI_JAVASCRIPT_MAX_CODE_CHARS, description: `Complete JavaScript module or script source, not a function body. Provide exactly one of code or entry_file. Set format explicitly for generated code. CommonJS returns through module.exports and generated async CommonJS should use module.exports = main(); ESM returns its module namespace and should use top-level await for async work. Up to ${AI_JAVASCRIPT_MAX_CODE_CHARS} characters.` },
      entry_file: { type: "string", description: "Workspace-relative entry-file path. Provide exactly one of entry_file or code. The entry and its static dependencies use the effective view, including unsaved editor changes. Relative imports inside the entry resolve from the entry file's directory." },
      format: { type: "string", enum: ["auto", "commonjs", "module", "umd", "global"], description: "Script format. Generated code should use commonjs or module to match its syntax. Use auto for an existing workspace file when inference from its extension, nearest package.json, and source syntax is appropriate. Do not use auto to hide mixed module syntax." },
      resolve_from: { type: "string", description: "For inline code only, the workspace-relative directory from which relative require/import specifiers and workspace node_modules are resolved. Defaults to the workspace root. It does not affect relative node:fs paths or imports inside entry_file." },
      cwd: { type: "string", description: "Workspace-relative base directory for process.cwd() and relative node:fs paths. Omit it or use '.' for the workspace root. Virtual absolute paths beginning with '/' are also rooted at the workspace." },
      input: { type: "object", description: "Optional JSON object exposed as the global input value. Use it for structured non-sensitive data, not file contents or secrets." },
      env: { type: "object", additionalProperties: { type: "string" }, description: "Non-sensitive values injected into process.env. Values are converted to strings. Use credentials for secrets." },
      args: { type: "array", items: { type: "string" }, description: "Command-line arguments converted to strings and available through process.argv.slice(2)." },
      dependencies: { type: "array", maxItems: AI_JAVASCRIPT_MAX_FILE_COUNT, items: { type: "string" }, description: "Pinned npm package-root specifications used only when a bare import cannot be resolved from workspace node_modules, for example jpeg-js@0.4.4 or @scope/package@1.2.3. Source code still imports the ordinary bare name. Do not pass package subpaths, relative paths, or HTTP/HTTPS URLs. The same package cannot have conflicting declared versions, and an installed workspace package remains preferred." },
      registry_url: { type: "string", description: "Optional trusted npm-compatible Registry root URL for dependencies and inline npm: specifiers. It must be HTTP/HTTPS and contain no credentials, query, or fragment. Omit it to use the user setting, or https://registry.npmjs.org when that setting is empty. Do not switch registries merely to retry an invalid package name or version." },
      credentials: { type: "array", items: { type: "string" }, description: "Keys of previously loaded credentials to inject into process.env. Pass Keys only, never values. Credentials override same-named env entries; missing Keys become empty strings." },
      proxy_options: { type: "object", description: "Optional backend request-proxy behavior. Omit unless the user explicitly requests target source headers.", properties: {
        use_target_origin: { type: "boolean", description: "Ask the backend proxy to send Origin using each target URL's origin. Defaults to false. Set only when the user explicitly requests it; do not enable it automatically as a request-failure workaround." },
        use_target_referer: { type: "boolean", description: "Ask the backend proxy to send Referer using each target URL's origin. Defaults to false. Set only when the user explicitly requests it; do not enable it automatically as a request-failure workaround." }
      } },
      input_files: { type: "array", maxItems: AI_JAVASCRIPT_MAX_FILE_COUNT, description: "Every existing non-module workspace file read through node:fs or node:fs/promises must be declared here. A file's presence in the workspace does not place it in the virtual filesystem; reading an undeclared file fails with FILE_NOT_FOUND. JavaScript, JSON, and package files referenced by static import or require are loaded automatically and should not be declared again.", items: { type: "object", properties: {
        path: { type: "string", description: "Required existing file path relative to the workspace root. Absolute paths, reserved runtime paths, and paths outside the workspace are invalid." },
        type: { type: "string", enum: ["text", "bytes"], description: "Load mode. Defaults to text; binary files must use bytes." },
        view: { type: "string", enum: ["effective", "base"], description: "effective includes unsaved changes; base reads only saved disk content. Defaults to effective." }
      }, required: ["path"] } },
      output_files: { type: "array", maxItems: AI_JAVASCRIPT_MAX_FILE_COUNT, description: "Exact files to extract after execution. A file is returned only if the script creates or changes its declared path; undeclared temporary files are discarded. Prefer this when output names are known.", items: { type: "object", properties: {
        path: { type: "string", description: "Required exact output path relative to the workspace root. The path actually written by the script must match it; account for cwd when the script uses a relative filesystem path." },
        type: { type: "string", enum: ["text", "bytes"], description: "Expected output type. When omitted, it is inferred from MIME information and the extension. Prefer bytes explicitly for binary output." },
        overwrite: { type: "boolean", description: "Allow replacing an existing saved or unsaved workspace file. Defaults to false; an existing target otherwise fails the entire call." }
      }, required: ["path"] } },
      output_directories: { type: "array", maxItems: AI_JAVASCRIPT_MAX_FILE_COUNT, description: "Directories from which dynamically named changed child files should be extracted. Directories themselves, empty directories, and deletions are not extracted. Prefer output_files when names are known, and avoid unnecessarily broad scopes.", items: { type: "object", properties: {
        path: { type: "string", description: "Required directory path relative to the workspace root. Use '.', not an empty string, for the workspace root." },
        overwrite: { type: "boolean", description: "Allow replacing existing files within this directory. Defaults to false and never permits a file/directory type conflict." }
      }, required: ["path"] } },
      timeout_ms: { type: "number", exclusiveMinimum: 0, maximum: AI_JAVASCRIPT_MAX_TIMEOUT_MS, description: `Script execution timeout in milliseconds. It must be a positive finite number, defaults to ${AI_JAVASCRIPT_DEFAULT_TIMEOUT_MS}, and is capped at ${AI_JAVASCRIPT_MAX_TIMEOUT_MS}. Dependency preparation and individual network requests are also constrained by this value and their own internal limits.` }
    }, required: ["reason"] } },
    { type: "function", name: "list_files", requirements: ["workspace"], description: aiToolDescription("List workspace files and directories.", "Use path relative to workspace root. Use an empty path or '.' for the workspace root. By default only the first level is listed; set recursive to true for descendants. Use max_items to keep output concise."), parameters: { type: "object", properties: { path: { type: "string", description: "Optional directory path relative to workspace root. '.' means workspace root." }, max_items: { type: "number", description: "Maximum items to return. Capped internally." }, recursive: { type: "boolean", description: "Whether to recursively list descendants. Defaults to false." } } } },
    { type: "function", name: "refresh_tree", requirements: ["workspace"], description: aiToolDescription("Refresh the workspace file tree from disk.", "Use this before locating files that may have been created, deleted, renamed, downloaded, or externally changed."), parameters: { type: "object", properties: { collapse_all: { type: "boolean", description: "Whether to collapse all directories after refreshing. Defaults to false." } } } },
    { type: "function", name: "read_file", requirements: ["workspace"], description: aiToolDescription("Read a workspace text file.", "Dirty in-memory content is returned when present. Use offset and limit for partial line-based reads. This tool only reads text-like files; binary or unsupported files will fail.", "Use max_chars to keep large files concise; default is intentionally limited."), parameters: { type: "object", properties: { path: { type: "string" }, offset: { type: "number", description: "Optional 1-based starting line number. Defaults to 1." }, limit: { type: "number", description: "Optional maximum number of lines to return." }, max_chars: { type: "number", description: aiToolOutputLimitDescription() } }, required: ["path"] } },
    { type: "function", name: "read_files", requirements: ["workspace"], description: aiToolDescription("Read multiple workspace text files in one call.", "Prefer this over repeated read_file calls when several files are known. Dirty in-memory content is returned when present. Offset and limit apply to each file.", "Use max_chars_per_file to keep large files concise; default is intentionally limited."), parameters: { type: "object", properties: { paths: { type: "array", items: { type: "string" } }, offset: { type: "number", description: "Optional 1-based starting line number applied to each file. Defaults to 1." }, limit: { type: "number", description: "Optional maximum number of lines to return per file." }, max_chars_per_file: { type: "number", description: aiToolOutputLimitDescription() } }, required: ["paths"] } },
    { type: "function", name: "read_image", requirements: ["workspace"], description: aiToolDescription("Read an image file and attach it to the next model turn for visual analysis.", "Use this for screenshots, diagrams, mockups, and other workspace image files. Do not use it for non-image files or oversized images."), parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
    { type: "function", name: "generate_or_edit_image", requirements: ["workspace"], description: aiToolDescription(
      "Generate a new image or edit an existing workspace image using the configured image model.",
      "Omit input_path to use the image generation endpoint. Provide input_path to use the image edit endpoint; mask_path is optional and requires input_path.",
      "The result replaces the workspace image's in-memory content and is not written to disk until the user saves it. Editing into the same path is safe because the saved disk image remains the revert baseline. Set overwrite only when intentionally targeting another existing file.",
      "Only PNG, JPEG, and WebP output paths are supported. Keep prompts self-contained because the image API does not receive the coding-agent conversation."
    ), parameters: { type: "object", properties: {
      prompt: { type: "string", description: "Complete image generation or editing prompt." },
      output_path: { type: "string", description: "Workspace-relative output path ending in .png, .jpg, .jpeg, or .webp." },
      input_path: { type: "string", description: "Optional workspace image path. When present, the edit endpoint is used." },
      mask_path: { type: "string", description: "Optional workspace mask image path for image editing." },
      size: { type: "string", description: "Provider-supported image size, for example auto, 1024x1024, 1536x1024, or 1024x1536." },
      quality: { type: "string", description: "Provider-supported quality. GPT Image commonly uses auto, low, medium, or high; DALL-E 3 uses standard or hd." },
      background: { type: "string", description: "Generation background, for example auto, opaque, or transparent." },
      output_format: { type: "string", description: "Optional png, jpeg, or webp. Defaults from output_path." },
      overwrite: { type: "boolean", description: "Allow targeting an existing output file other than input_path. The disk file remains unchanged until manual save." }
    }, required: ["prompt", "output_path"] } },
    { type: "function", name: "search_text", requirements: ["workspace"], description: aiToolDescription("Search exact text across workspace files.", "This is a simple substring search, not a regex search. Use path to limit the search scope and max_results to keep output concise."), parameters: { type: "object", properties: { query: { type: "string" }, path: { type: "string" }, max_results: { type: "number" } }, required: ["query"] } },
    { type: "function", name: "get_current_file", requirements: ["workspace"], description: aiToolDescription("Get the current editor file, cursor position, and selected text.", "Use this for editor context only; do not assume the current file is the user's intended target when recent chat or AI-touched files indicate another file."), parameters: { type: "object", properties: {} } },
    { type: "function", name: "replace_in_file", requirements: ["workspace"], description: aiToolDescription("Replace the first exact text occurrence in a workspace file in memory.", "Use this for minimal local edits with exact old_text and new_text, similar to patch hunks. Do not pass whole-file old_text/new_text unless the file is tiny and no smaller stable edit is possible.", "This edits only the in-memory editor model. Changes are not saved to disk until the user saves. Do not claim the file changed unless this tool reports success."), parameters: { type: "object", properties: { path: { type: "string" }, old_text: { type: "string" }, new_text: { type: "string" } }, required: ["path", "old_text", "new_text"] } },
    { type: "function", name: "replace_in_files", requirements: ["workspace"], description: aiToolDescription("Apply multiple exact local replacements in one call.", "Prefer this over repeated replace_in_file calls when several edits are known. Use it after batch-reading files and planning several patch hunks. Individual edit failures do not abort the whole batch; inspect per-edit results.", "This edits only in-memory editor models. Changes are not saved to disk until the user saves. Only report files as changed when their individual edit result succeeded."), parameters: { type: "object", properties: { edits: { type: "array", items: { type: "object", properties: { path: { type: "string" }, old_text: { type: "string" }, new_text: { type: "string" } }, required: ["path", "old_text", "new_text"] } } }, required: ["edits"] } },
    { type: "function", name: "write_file", requirements: ["workspace"], description: aiToolDescription("Create or replace a whole workspace file in memory.", "Use only for new files, tiny files, generated files, or when exact local replacement is not stable.", "This edits only the in-memory editor model. New files are not written to disk until the user saves. Do not claim the file changed unless this tool reports success."), parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
    { type: "function", name: "delete_file", requirements: ["workspace"], description: aiToolDescription("Mark a workspace file for deletion in memory.", "Existing disk files are deleted only when the user saves the deletion. Unsaved new files are removed immediately from memory.", "Be careful resolving ambiguous references before deleting. Do not claim the file was deleted unless this tool reports success."), parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
    { type: "function", name: "open_file", requirements: ["workspace"], description: aiToolDescription("Open a workspace file in the editor.", "Use this when the user wants a file displayed or when visual editor context is useful."), parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
    { type: "function", name: "show_diff", requirements: ["workspace"], description: aiToolDescription("Show the diff for an in-memory changed file.", "Use this for files changed, created, or marked for deletion in the editor session."), parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
    { type: "function", name: "request_proxy", requirements: ["backend"], description: aiToolDescription(
      "Fetch an external HTTP/HTTPS URL through the configured backend request proxy to avoid browser CORS limits.",
      "Declare credential Keys through credentials, then use ${KEY}, ${KEY|urlencode}, ${KEY|json}, or ${KEY|base64} in the URL, header values, or body. Missing Keys are empty strings. Use $${KEY} for a literal placeholder.",
      "Only http and https URLs are supported. GET and HEAD requests cannot include a body. Prefer compact API formats when available. If a successful response contains enough information, answer from it instead of making follow-up requests.",
      "proxy_options controls backend proxy behavior. Its use_target_origin and use_target_referer fields synthesize source headers from the target URL. Do not set either source-header option unless the user explicitly requests it; never enable them automatically to retry a failed, CORS-blocked, or XSRF-rejected request.",
      "Use filter_script to reduce large response bodies at the source of the tool result: it runs after the request in an isolated Worker and the tool body becomes the script return value."
    ), parameters: { type: "object", properties: {
      url: { type: "string", description: "Absolute target URL, including query string if needed. Supports declared credential placeholders." },
      method: { type: "string", description: "HTTP method. Defaults to GET." },
      headers: { type: "object", additionalProperties: { type: "string" }, description: "Optional request headers. Header values support declared credential placeholders." },
      body: { type: "string", description: "Optional request body supporting declared credential placeholders. Not allowed for GET or HEAD." },
      credentials: { type: "array", items: { type: "string" }, description: "Credential Keys available to URL, header value, and body placeholders." },
      proxy_options: { type: "object", description: "Optional backend request-proxy behavior.", properties: {
        follow_redirect: { type: "boolean", description: "Whether the backend proxy should follow redirects. Defaults to true." },
        enable_cors: { type: "boolean", description: "Whether the proxy response should include permissive CORS headers. Defaults to true." },
        use_target_origin: { type: "boolean", description: "Send Origin using the target URL's origin. Defaults to false. Set only when the user explicitly requests it." },
        use_target_referer: { type: "boolean", description: "Send Referer using the target URL's origin. Defaults to false. Set only when the user explicitly requests it." }
      } },
      include_headers: { type: "boolean", description: "Whether to include response headers in the tool result. Defaults to false." },
      filter_script: { type: "string", description: "Optional JavaScript async function body used to filter only the response body before returning it. input is the response body string." },
      max_chars: { type: "number", description: aiToolOutputLimitDescription() }
    }, required: ["url"] } },
    { type: "function", name: "get_ssh_connections", requirements: ["backend", "ssh_exposed"], description: aiToolDescription("Get SSH settings exposed to AI.", "Returns id, name, host, port, active state, and command whitelist. Secrets are never returned. Use this before opening or choosing an SSH connection when the target is ambiguous."), parameters: { type: "object", properties: {} } },
    { type: "function", name: "open_ssh_connection", requirements: ["backend", "ssh_exposed"], description: aiToolDescription("Open an exposed SSH connection by id, name, or host.", "The backend SSH WebSocket performs the actual SSH connection. Reuse active connections when possible instead of reconnecting.", "Open a connection only for a task that explicitly targets or inherently depends on that remote host."), parameters: { type: "object", properties: { connection: { type: "string", description: "SSH setting id, name, or host." } }, required: ["connection"] } },
    { type: "function", name: "activate_ssh_terminal", requirements: ["backend", "ssh_exposed"], description: aiToolDescription("Switch the visible editor tab to an already active exposed SSH terminal.", "This does not execute any SSH command. It requires the connection to already be active."), parameters: { type: "object", properties: { connection: { type: "string", description: "SSH setting id, name, or host." } }, required: ["connection"] } },
    { type: "function", name: "close_ssh_connection", requirements: ["backend", "ssh_exposed"], description: aiToolDescription("Close an active exposed SSH connection by id, name, or host.", "Use only when the user asks to disconnect or when cleanup is clearly part of the requested task."), parameters: { type: "object", properties: { connection: { type: "string", description: "SSH setting id, name, or host." } }, required: ["connection"] } },
    { type: "function", name: "read_ssh_output", requirements: ["backend", "ssh_exposed"], description: aiToolDescription("Read recent output from an active exposed SSH connection.", "This reads the SSH terminal transcript. Commands run through execute_ssh_command and commands manually typed by the user can both appear here, along with their outputs, prompts, and terminal control artifacts.", "Use this to inspect terminal context when needed. When the distinction matters, separate AI-run commands and results from user-run commands and results before drawing conclusions. Output may be truncated and may include ANSI terminal artifacts."), parameters: { type: "object", properties: { connection: { type: "string", description: "SSH setting id, name, or host." }, max_chars: { type: "number", description: aiToolOutputLimitDescription() } }, required: ["connection"] } },
    { type: "function", name: "execute_ssh_command", requirements: ["backend", "ssh_exposed"], description: aiToolDescription(
      "Execute a command on an active exposed SSH connection.",
      "Use this only for work that must occur on the selected remote host.",
      "Prefer commands from the connection whitelist when they can complete the task, and choose concise commands or flags that produce short output when possible.",
      "You must provide a clear reason, commands array containing every main command used by the shell command, and high_risk based on your own risk assessment.",
      "If an SSH command approval is rejected, do not try alternate SSH commands for the same purpose unless the user explicitly asks you to continue or grants permission. List every SSH command you ran in your final answer."
    ), parameters: { type: "object", properties: {
      connection: { type: "string", description: "SSH setting id, name, or host." },
      command: { type: "string" },
      commands: { type: "array", items: { type: "string" }, description: "Required list of main commands used by command, excluding arguments. Include every command in chains, pipes, and substitutions." },
      high_risk: { type: "boolean", description: "Required AI-assessed risk flag." },
      reason: { type: "string", description: "Required explanation of why this SSH command is needed." }
    }, required: ["connection", "command", "commands", "high_risk", "reason"] } },
    { type: "function", name: "sftp_upload_file", requirements: ["backend", "ssh_exposed", "workspace"], description: aiToolDescription("Submit one SFTP upload task and return its task_id.", "local_path is a workspace-relative source file path only; remote_path is the destination file path on the SSH server. Missing remote parent directories are created automatically.", "Do not pass absolute local paths, URLs, or SSH server paths as local_path. Upload returns after task submission; only briefly wait or poll completion for likely-small files such as text files or roughly under 1MB. For larger or unknown-size files, report that the task was submitted unless the user explicitly asks to wait or a next step truly depends on completion."), parameters: { type: "object", properties: { connection: { type: "string", description: "SSH setting id, name, or host." }, local_path: { type: "string", description: "Workspace-relative source file path only, for example 'dist/app.zip' or 'src/main.js'." }, remote_path: { type: "string", description: "Destination file path on the SSH server. Missing parent directories are created automatically." }, use_unsaved: { type: "boolean", description: "Upload unsaved dirty editor content when available. Defaults to true." } }, required: ["connection", "local_path", "remote_path"] } },
    { type: "function", name: "sftp_download_file", requirements: ["backend", "ssh_exposed", "workspace"], description: aiToolDescription("Submit one SFTP download task and return its task_id.", "remote_path is the source file path on the SSH server; local_path is a workspace-relative destination path. Parent directories are created automatically.", "Do not pass absolute local paths, URLs, or SSH server paths as local_path. Download returns after task submission; only briefly wait or poll completion for likely-small files such as text files or roughly under 1MB. For larger or unknown-size files, report that the task was submitted unless the user explicitly asks to wait or a next step truly depends on completion."), parameters: { type: "object", properties: { connection: { type: "string", description: "SSH setting id, name, or host." }, remote_path: { type: "string", description: "Source file path on the SSH server." }, local_path: { type: "string", description: "Workspace-relative destination file path only, for example 'downloads/app.zip'." } }, required: ["connection", "remote_path", "local_path"] } },
    { type: "function", name: "sftp_list_tasks", requirements: ["backend", "ssh_exposed", "workspace"], description: aiToolDescription("List SFTP upload/download tasks submitted from the current page.", "Returns task progress and status. Prefer calling without status first when locating a task, because a task may already be in a different state than expected and a status filter could hide it.", "Do not repeatedly call this just to wait for large or unknown-size transfers; use it when checking is explicitly needed."), parameters: { type: "object", properties: { status: { type: "string", description: "Optional status filter: running, completed, failed, or cancelled. Omit when unsure so tasks in other states are still returned." } } } },
    { type: "function", name: "sftp_cancel_task", requirements: ["backend", "ssh_exposed", "workspace"], description: aiToolDescription("Cancel a running SFTP task.", "Use task_id returned by sftp_upload_file, sftp_download_file, or sftp_list_tasks. Completed, failed, or already-cancelled tasks cannot be cancelled."), parameters: { type: "object", properties: { task_id: { type: "string", description: "Task id returned by sftp_upload_file, sftp_download_file, or sftp_list_tasks." } }, required: ["task_id"] } },
  ];
}

function aiToolGetToolAvailability({ names } = {}) {
  const definitions = new Map(getAiAllToolDefinitions().map((tool) => [tool.name, tool]));
  const requestedNames = uniqueStrings(Array.isArray(names) ? names.map((name) => String(name || "").trim()).filter(Boolean) : []);
  const selected = requestedNames.length ? requestedNames : Array.from(definitions.keys());
  const tools = selected.map((name) => {
    const tool = definitions.get(name);
    if (!tool) return { name, found: false };
    const availability = getAiToolAvailability(tool);
    return {
      name: tool.name,
      found: true,
      available: availability.available,
      unavailable_reason: availability.reason || "",
      ...(tool.name === "run_javascript" ? { capabilities: { files: isWorkspaceLoaded(), direct_network: true, proxy_network: isBackendEnabled() } } : {}),
      requirements: (tool.requirements || []).map((requirement) => {
        const status = getAiRequirementStatus(requirement);
        return { name: requirement, available: status.met, reason: status.met ? "" : status.reason };
      }),
    };
  });
  return {
    summary: `${tools.filter((tool) => tool.found !== false && tool.available).length}/${tools.length} tool(s) available`,
    requirements: ["workspace", "backend", "ssh_exposed"].map((requirement) => {
      const status = getAiRequirementStatus(requirement);
      return { name: requirement, available: status.met, reason: status.met ? "" : status.reason };
    }),
    tools,
  };
}

function aiToolDescription(...parts) {
  return parts.filter(Boolean).join("\n\n");
}

function aiToolOutputLimitDescription() {
  return `Maximum characters returned. Defaults to ${AI_TOOL_OUTPUT_DEFAULT_MAX_CHARS}; capped at ${AI_TOOL_OUTPUT_HARD_MAX_CHARS}.`;
}

function clipAiToolText(value, maxChars) {
  const text = String(value ?? "");
  const limit = clampToolCharLimit(maxChars);
  return {
    text: text.slice(0, limit),
    text_chars: text.length,
    returned_chars: Math.min(text.length, limit),
    truncated: text.length > limit,
  };
}

function clipAiToolTailText(value, maxChars) {
  const text = String(value ?? "");
  const limit = clampToolCharLimit(maxChars);
  return {
    text: text.slice(-limit),
    text_chars: text.length,
    returned_chars: Math.min(text.length, limit),
    truncated: text.length > limit,
  };
}

function sanitizeAiTerminalOutput(value) {
  return String(value ?? "")
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B[PX^_][\s\S]*?\x1B\\/g, "")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1B[()][A-Za-z0-9]/g, "")
    .replace(/\x1B[=>]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function getAiToolAvailability(name) {
  const tool = typeof name === "string" ? getAiToolDefinitionByName(name) : name;
  if (!tool) return { found: false, available: false, reason: "Unknown tool" };
  const unmet = (tool.requirements || []).map(getAiRequirementStatus).filter((requirement) => !requirement.met);
  return { found: true, available: unmet.length === 0, reason: unmet.map((requirement) => requirement.reason).join("; ") };
}

function formatAiToolDescriptionWithCondition(tool = {}) {
  const condition = getAiToolConditionDescription(tool);
  return condition ? `${tool.description || ""} Condition: ${condition}` : (tool.description || "");
}

function getAiToolConditionDescription(tool) {
  if (typeof tool === "string") tool = getAiToolDefinitionByName(tool);
  return (tool?.requirements || []).map(getAiRequirementStatus).map((requirement) => requirement.description).join("; ");
}

function getAiToolDefinitionByName(name) {
  return getAiAllToolDefinitions().find((tool) => tool.name === name) || null;
}

function getAiRequirementStatus(requirement) {
  switch (requirement) {
    case "workspace": return { met: isWorkspaceLoaded(), description: "requires an open workspace folder", reason: "No workspace folder is open" };
    case "backend": return { met: isBackendEnabled(), description: "requires backend server enabled", reason: "Backend server setting is disabled" };
    case "ssh_exposed": return { met: getAiExposedSshConfigs().length > 0, description: "requires at least one SSH setting exposed to AI", reason: "No SSH setting is exposed to AI" };
    default: return { met: false, description: `requires ${requirement}`, reason: `Unknown requirement: ${requirement}` };
  }
}

function stripAiToolInternalMetadata(tool) {
  const { requirements, ...definition } = tool;
  return { ...definition, description: formatAiToolDescriptionWithCondition(tool) };
}

function parseAiToolArguments(call) {
  return call.arguments ? JSON.parse(call.arguments) : {};
}

async function runAiToolCall(call, args = {}, session = getActiveAiSession(), signal) {
  try {
    const availability = getAiToolAvailability(call.name);
    if (availability.found && !availability.available) return { ok: false, summary: `Tool ${call.name} is unavailable because ${availability.reason}` };
    switch (call.name) {
      case "get_tool_availability": return okTool(aiToolGetToolAvailability(args));
      case "load_credentials": return okTool(await aiToolLoadCredentials(args));
      case "list_credentials": return okTool(aiToolListCredentials());
      case "list_files": return okTool(await aiToolListFiles(args));
      case "refresh_tree": return okTool(await aiToolRefreshTree(args));
      case "read_file": return okTool(await aiToolReadFile(args));
      case "read_files": return okTool(await aiToolReadFiles(args));
      case "generate_or_edit_image": return okTool(await aiToolGenerateOrEditImage(args, session, signal));
      case "search_text": return okTool(await aiToolSearchText(args));
      case "run_javascript": return await aiToolRunJavaScript(args, signal, session);
      case "request_proxy": return okTool(await aiToolRequestProxy(args, signal));
      case "get_ssh_connections": return okTool(aiToolGetSshConnections());
      case "open_ssh_connection": return okTool(await aiToolOpenSshConnection(args.connection));
      case "activate_ssh_terminal": return okTool(aiToolActivateSshTerminal(args.connection));
      case "close_ssh_connection": return okTool(aiToolCloseSshConnection(args.connection));
      case "read_ssh_output": return okTool(aiToolReadSshOutput(args));
      case "sftp_upload_file": return okTool(await aiToolSftpUploadFile(args));
      case "sftp_download_file": return okTool(await aiToolSftpDownloadFile(args));
      case "sftp_list_tasks": return okTool(aiToolSftpListTasks(args));
      case "sftp_cancel_task": return okTool(aiToolSftpCancelTask(args));
      case "execute_ssh_command": return okTool(await aiToolExecuteSshCommand(args, signal));
      case "get_current_file": return okTool(aiToolGetCurrentFile());
      case "replace_in_file": return okTool(await aiToolReplaceInFile(args, session));
      case "replace_in_files": return okTool(await aiToolReplaceInFiles(args, session));
      case "write_file": return okTool(await aiToolWriteFile(args, session));
      case "delete_file": return okTool(await aiToolDeleteFile(args.path, session));
      case "open_file": return okTool(await aiToolOpenFile(args.path));
      case "show_diff": return okTool(await aiToolShowDiff(args.path));
      default: return { ok: false, summary: `Unknown tool: ${call.name}` };
    }
  } catch (error) {
    if (error.name === "AbortError") throw error;
    return { ok: false, summary: error.message || String(error) };
  }
}

function okTool(result) {
  return { ok: true, ...result };
}

const formatterDisposables = [];

function registerFormatters() {
  formatterDisposables.splice(0).forEach((disposable) => disposable.dispose());
  const languages = ["javascript", "typescript", "html", "css", "scss", "less", "json", "markdown", "graphql", "yaml"];

  languages.forEach((language) => {
    formatterDisposables.push(monaco.languages.registerDocumentFormattingEditProvider(language, {
      async provideDocumentFormattingEdits(model) {
        const file = getFileByModel(model);
        const formatted = await formatCode(model.getValue(), file?.language || language);
        return formatted == null ? [] : [{ range: model.getFullModelRange(), text: formatted }];
      },
    }));
  });
}

function getFileByModel(model) {
  return Array.from(openFiles.values()).find((file) => file.model === model);
}

async function formatCode(source, language) {
  const prettierConfig = getPrettierConfig(language);
  if (!prettierConfig) return null;

  const { prettier, plugins } = await loadPrettierBundle(prettierConfig.plugins);
  return prettier.format(source, {
    parser: prettierConfig.parser,
    plugins,
    printWidth: 100,
    tabWidth: 2,
    useTabs: false,
    semi: true,
    singleQuote: false,
  });
}

function getPrettierConfig(language) {
  const configs = {
    javascript: { parser: "babel", plugins: ["babel", "estree"] },
    flow: { parser: "flow", plugins: ["flow", "estree"] },
    typescript: { parser: "typescript", plugins: ["typescript", "estree"] },
    html: { parser: "html", plugins: ["html"] },
    vue: { parser: "vue", plugins: ["html"] },
    angular: { parser: "angular", plugins: ["angular", "html"] },
    handlebars: { parser: "glimmer", plugins: ["glimmer"] },
    css: { parser: "css", plugins: ["postcss"] },
    scss: { parser: "scss", plugins: ["postcss"] },
    less: { parser: "less", plugins: ["postcss"] },
    json: { parser: "json", plugins: ["babel", "estree"] },
    jsonc: { parser: "jsonc", plugins: ["babel", "estree"] },
    json5: { parser: "json5", plugins: ["babel", "estree"] },
    markdown: { parser: "markdown", plugins: ["markdown"] },
    mdx: { parser: "mdx", plugins: ["markdown"] },
    graphql: { parser: "graphql", plugins: ["graphql"] },
    yaml: { parser: "yaml", plugins: ["yaml"] },
  };
  return configs[language] || null;
}

async function loadPrettierBundle(pluginNames) {
  if (!prettierStandalonePromise) {
    prettierStandalonePromise = import("prettier/standalone").then(resolveModuleDefault).catch((error) => {
      prettierStandalonePromise = null;
      throw error;
    });
  }
  const [prettier, plugins] = await Promise.all([
    prettierStandalonePromise,
    Promise.all(pluginNames.map(loadPrettierPlugin)),
  ]);
  return { prettier, plugins };
}

function loadPrettierPlugin(name) {
  if (!prettierPluginPromises.has(name)) {
    const loader = prettierPluginLoaders[name];
    if (!loader) return Promise.reject(new Error(`Unsupported Prettier plugin: ${name}`));
    prettierPluginPromises.set(name, loader().then(resolveModuleDefault).catch((error) => {
      prettierPluginPromises.delete(name);
      throw error;
    }));
  }
  return prettierPluginPromises.get(name);
}

const prettierPluginLoaders = Object.freeze({
  angular: () => import("prettier/plugins/angular"),
  babel: () => import("prettier/plugins/babel"),
  estree: () => import("prettier/plugins/estree"),
  flow: () => import("prettier/plugins/flow"),
  glimmer: () => import("prettier/plugins/glimmer"),
  graphql: () => import("prettier/plugins/graphql"),
  html: () => import("prettier/plugins/html"),
  markdown: () => import("prettier/plugins/markdown"),
  postcss: () => import("prettier/plugins/postcss"),
  typescript: () => import("prettier/plugins/typescript"),
  yaml: () => import("prettier/plugins/yaml"),
});

function resolveModuleDefault(module) {
  return module?.default ?? module;
}

function toggleSidePanel() {
  sidePanelVisible.value = !sidePanelVisible.value;
  nextTick(() => editor.value?.layout());
}

function startSidebarResize(event) {
  if (!sidePanelVisible.value) return;
  event.preventDefault();
  sidebarResizing.value = true;
  event.currentTarget.setPointerCapture?.(event.pointerId);
  const move = (moveEvent) => {
    const activityWidth = document.querySelector(".activity-bar")?.getBoundingClientRect().width || 48;
    sidebarWidth.value = clampSidebarWidth(moveEvent.clientX - activityWidth);
    editor.value?.layout();
    diffEditor.value?.layout();
  };
  const stop = () => {
    sidebarResizing.value = false;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
    nextTick(() => editor.value?.layout());
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
  move(event);
}

function clampSidebarWidth(value) {
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.round(Number(value) || DEFAULT_SIDEBAR_WIDTH)));
}

function startPreviewResize(event) {
  if (!previewPaneVisible.value) return;
  event.preventDefault();
  previewResizing.value = true;
  event.currentTarget.setPointerCapture?.(event.pointerId);
  const stage = event.currentTarget.closest(".editor-stage");
  const move = (moveEvent) => {
    const stageRight = stage?.getBoundingClientRect().right || window.innerWidth;
    previewWidth.value = clampPreviewWidth(stageRight - moveEvent.clientX);
    layoutVisibleEditors();
  };
  const stop = () => {
    previewResizing.value = false;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
    nextTick(layoutVisibleEditors);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
  move(event);
}

function clampPreviewWidth(value) {
  return Math.max(PREVIEW_MIN_WIDTH, Math.min(PREVIEW_MAX_WIDTH, Math.round(Number(value) || DEFAULT_PREVIEW_WIDTH)));
}

function triggerFindReferences() {
  if (!activeFile.value) return;
  const targetEditor = activeDiffPath.value ? diffEditor.value?.getModifiedEditor?.() : editor.value;
  targetEditor?.focus?.();
  targetEditor?.trigger("browser-editor", "editor.action.goToReferences", null);
}

function setStatus(left, right) {
  status.left = left;
  status.right = right || "";
}

function reportError(messageKey, error) {
  console.error(tr(messageKey), error);
  const message = formatFileOperationError(error);
  setStatus(tr(messageKey), message);
  showAlert(`${tr(messageKey)}: ${message}`, { tone: "danger" });
}

function reportFileOperationError(error) {
  console.error("File operation failed", error);
  const message = formatFileOperationError(error);
  setStatus(message, "");
  void showAlert(message, { tone: "danger" });
}

function formatFileOperationError(error) {
  if (error instanceof FileTooLargeError || error?.code === "FILE_TOO_LARGE") {
    return tr("error.fileTooLarge", {
      path: error.path || "",
      size: FileUtils.formatFileSize(error.size),
      limit: FileUtils.formatFileSize(error.maxSize),
    });
  }
  return error?.message || String(error);
}

function beforeUnload(event) {
  if (!shouldConfirmLeaveEditor()) return;
  const message = tr("confirm.leaveWithSsh");
  event.preventDefault();
  event.returnValue = message;
  return message;
}

function handlePageHide() {
  queuePersistSavedAiSessions();
  cancelRunningSftpTasks();
  closeAllSshSessions({ disposeTerminal: true });
}

function hasUnsavedFiles() {
  return Array.from(openFiles.values()).some((file) => file.dirty);
}

function shouldConfirmLeaveEditor() {
  return hasUnsavedFiles() || hasActiveSshSessions() || hasRunningSftpTasks();
}

function hasRunningSftpTasks() {
  return sftpTasks.some((task) => task.status === "running");
}

function cancelRunningSftpTasks() {
  sftpTasks.filter((task) => task.status === "running").forEach((task) => cancelSftpTask(task.id));
}

function hasActiveSshSessions() {
  return Array.from(sshSessions.values()).some(isSshSessionActive);
}

function isSshSessionActive(session) {
  return Boolean(session && !session.closing && (session.connected || session.ws?.readyState === WebSocket.CONNECTING || session.ws?.readyState === WebSocket.OPEN));
}

async function exportSettingsUrl() {
  const url = new URL(CODE_EDITOR_WEB_PATH, window.location.origin);
  url.searchParams.delete(SETTINGS_URL_PARAM);
  url.hash = `${SETTINGS_URL_PARAM}=${await encodeSettingsForUrl(settings)}`;
  const value = url.toString();
  try {
    await navigator.clipboard.writeText(value);
    setStatus(tr("settings.exportUrlCopied"), SETTINGS_URL_PARAM);
  } catch {
    await showPrompt(tr("settings.exportUrl"), value, { title: tr("settings.exportUrl"), confirmLabel: tr("dialog.close"), selectOnFocus: true });
  }
}

function loadSettings() {
  try {
    return normalizeSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"));
  } catch {
    return structuredClone(defaultSettings);
  }
}

async function promptImportSettingsFromUrl() {
  if (!readSettingsUrlValue()) return;
  let imported;
  try {
    imported = normalizeSettings(await readSettingsFromUrl());
  } catch {
    removeSettingsFromUrl();
    await showAlert(tr("settings.importInvalid"), { title: tr("settings.importTitle"), tone: "danger" });
    return;
  }
  const confirmed = await showConfirm(tr("settings.importConfirm"), {
    title: tr("settings.importTitle"),
    confirmLabel: tr("settings.importApply"),
    cancelLabel: tr("settings.importKeep"),
  });
  if (confirmed) {
    const importedLocale = imported.locale;
    applySettingsSnapshot(imported);
    if (importedLocale) setLocale(importedLocale);
    settings.locale = getCurrentLocale();
    persistSettings();
    setStatus(tr("settings.importApplied"), SETTINGS_URL_PARAM);
  } else {
    setStatus(tr("settings.importSkipped"), SETTINGS_URL_PARAM);
  }
  removeSettingsFromUrl();
}

function normalizeSettings(value = {}) {
  const savedSettings = { ...(value || {}) };
  delete savedSettings.sidebarWidth;
  delete savedSettings.previewWidth;
  const shortcuts = { ...vscodeShortcuts, ...(savedSettings.shortcuts || {}) };
  if (shortcuts.aiComplete === LEGACY_AI_COMPLETE_SHORTCUT) shortcuts.aiComplete = vscodeShortcuts.aiComplete;
  if (shortcuts.foldAll === LEGACY_FOLD_ALL_SHORTCUT) shortcuts.foldAll = vscodeShortcuts.foldAll;
  if (shortcuts.unfoldAll === LEGACY_UNFOLD_ALL_SHORTCUT) shortcuts.unfoldAll = vscodeShortcuts.unfoldAll;
  const ai = { ...defaultAiSettings, ...(savedSettings.ai || {}) };
  const backend = { ...defaultBackendSettings, ...(savedSettings.backend || {}) };
  const ssh = { ...defaultSshSettings, ...(savedSettings.ssh || {}) };
  savedSettings.maxMemoryReadBytes = normalizeMemoryLimit(savedSettings.maxMemoryReadBytes, DEFAULT_MAX_MEMORY_READ_BYTES);
  savedSettings.maxMemoryWriteBytes = normalizeMemoryLimit(savedSettings.maxMemoryWriteBytes, DEFAULT_MAX_MEMORY_WRITE_BYTES);
  if (!aiReasoningEfforts.includes(ai.reasoningEffort)) ai.reasoningEffort = defaultAiSettings.reasoningEffort;
  ai.autoSaveSessions = Boolean(ai.autoSaveSessions);
  ai.npmRegistryUrl = String(ai.npmRegistryUrl || "").trim().replace(/\/+$/, "");
  backend.enabled = Boolean(backend.enabled);
  backend.baseUrl = normalizeBackendBaseUrlValue(backend.baseUrl) || defaultBackendSettings.baseUrl;
  if (!sshTerminalThemes[ssh.terminalTheme]) ssh.terminalTheme = defaultSshSettings.terminalTheme;
  ssh.whitelistTemplate = String(ssh.whitelistTemplate || DEFAULT_SSH_WHITELIST_TEMPLATE).trim();
  ssh.connections = Array.isArray(ssh.connections) ? ssh.connections.map(normalizeStoredSshConfig).filter(Boolean) : [];
  return { ...defaultSettings, ...savedSettings, shortcuts, ai, backend, ssh };
}

function applySettingsSnapshot(value) {
  Object.keys(settings).forEach((key) => { delete settings[key]; });
  Object.assign(settings, value);
  settings.locale = getCurrentLocale();
  document.documentElement.lang = getCurrentLocale();
  if (monaco) applyTheme();
  applyEditorOptions();
  applySshTerminalTheme();
  if (monaco) registerKeybindings();
}

function normalizeStoredSshConfig(value) {
  const config = normalizeSshConfig(value);
  if (!config.id) config.id = createSshConfigId();
  return config.name || config.host ? config : null;
}

function readSettingsUrlValue() {
  return new URLSearchParams(window.location.hash.replace(/^#/, "")).get(SETTINGS_URL_PARAM);
}

async function readSettingsFromUrl() {
  const encoded = readSettingsUrlValue();
  if (!encoded) return null;
  return JSON.parse(await decodeSettingsFromUrl(encoded));
}

function removeSettingsFromUrl() {
  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
  hashParams.delete(SETTINGS_URL_PARAM);
  url.hash = hashParams.toString();
  window.history.replaceState(window.history.state, "", url.toString());
}

async function encodeSettingsForUrl(value) {
  const json = JSON.stringify(JSON.parse(JSON.stringify(value)));
  const bytes = await transformSettingsBytes(new TextEncoder().encode(json), new CompressionStream("deflate-raw"));
  return FileUtils.bytesToBase64Url(bytes);
}

async function decodeSettingsFromUrl(value) {
  const compressed = FileUtils.base64UrlToBytes(value);
  const bytes = await transformSettingsBytes(compressed, new DecompressionStream("deflate-raw"));
  return new TextDecoder().decode(bytes);
}

async function transformSettingsBytes(bytes, transform) {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function persistSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function normalizeMemoryLimit(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 ? Math.round(number) : fallback;
}

function bytesToMegabytes(value) {
  return Math.max(1, Number((normalizeMemoryLimit(value, MEBIBYTE) / MEBIBYTE).toFixed(2)));
}

function megabytesToBytes(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 ? Math.round(number * MEBIBYTE) : fallback;
}

function createFileOperationPolicy() {
  return new FileOperationPolicy({
    maxMemoryReadBytes: settings.maxMemoryReadBytes,
    maxMemoryWriteBytes: settings.maxMemoryWriteBytes,
    maxListEntries: Number.MAX_SAFE_INTEGER,
    maxWalkEntries: Number.MAX_SAFE_INTEGER,
  });
}

function syncFileOperationPolicy() {
  if (!fileSession.value) return;
  fileSession.value.fileSystem.policy.maxMemoryReadBytes = normalizeMemoryLimit(settings.maxMemoryReadBytes, DEFAULT_MAX_MEMORY_READ_BYTES);
  fileSession.value.fileSystem.policy.maxMemoryWriteBytes = normalizeMemoryLimit(settings.maxMemoryWriteBytes, DEFAULT_MAX_MEMORY_WRITE_BYTES);
}

function shouldHideName(name) {
  return name === ".git" || name === "node_modules" || name === ".DS_Store";
}

function isImageEntry(entry) {
  return FileUtils.isImageFile({ name: entry?.name, type: entry?.mimeType || entry?.type || "" });
}

function isReadableTextEntry(entry) {
  if (!entry || entry.kind === "directory" || isImageEntry(entry)) return false;
  const readable = FileUtils.isTextFile({ name: entry.name, type: entry.mimeType || entry.type || "" });
  return readable && (!Number.isFinite(entry.size) || entry.size <= fileSession.value.fileSystem.policy.maxMemoryReadBytes);
}

function assertReadableTextEntry(entry) {
  if (!entry || entry.kind === "directory" || isImageEntry(entry) || !FileUtils.isTextFile({ name: entry.name, type: entry.mimeType || entry.type || "" })) {
    throw new Error(`File is not readable text: ${entry?.path || entry?.name || ""}`);
  }
  fileSession.value.fileSystem.policy.assertMemoryRead(entry.path || entry.name, entry.size);
}

function assertOpenFileMemoryRead(file) {
  if (isTextFileState(file)) {
    fileSession.value.fileSystem.policy.assertMemoryRead(file.path, fileSession.value.fileSystem.policy.getTextSize(file.model.getValue()));
  } else {
    const blob = getActiveBlobFile(file);
    if (blob) fileSession.value.fileSystem.policy.assertMemoryRead(file.path, blob.size);
  }
}

function assertSpecialReadSize(path, size, businessLimit, operation) {
  const maxSize = Math.min(businessLimit, fileSession.value.fileSystem.policy.maxMemoryReadBytes);
  if (Number.isFinite(size) && size > maxSize) throw new FileTooLargeError(path, { size, maxSize, operation });
}

function normalizeWorkspacePath(path) {
  const value = decodeWorkspacePath(path).trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
  if (!value || value.split("/").some((part) => part === "..")) throw new Error(tr("error.invalidPath"));
  const normalized = normalizeFilePath(value);
  if (!normalized) throw new Error(tr("error.invalidPath"));
  return normalized;
}

function decodeWorkspacePath(path) {
  const value = String(path || "");
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

function findNodeByPath(nodes, path) {
  for (const node of nodes) {
    if (node.path === path) return node;
    const match = findNodeByPath(node.children || [], path);
    if (match) return match;
  }
  return null;
}

function flattenTree(nodes, maxItems = 200) {
  const items = [];
  const visit = (node) => {
    if (items.length >= maxItems) return;
    items.push({ path: node.path, kind: node.kind });
    (node.children || []).forEach(visit);
  };
  nodes.forEach(visit);
  return items;
}

function listTreeLevel(nodes, maxItems = 200) {
  return nodes.slice(0, maxItems).map((node) => ({ path: node.path, kind: node.kind }));
}

function isTextFileState(file) {
  return Boolean(file?.model && file.fileType === "text");
}

async function ensureFileState(path, options = {}) {
  const workspace = options.workspace || captureWorkspace();
  assertCurrentWorkspace(workspace);
  const normalized = normalizeWorkspacePath(path);
  if (isExternalWritePath(normalized, workspace.generation)) throw new Error(`File operation is already in progress: ${normalized}`);
  const existing = openFiles.get(normalized);
  if (existing) {
    if (!isTextFileState(existing)) throw new Error(`File is not readable text: ${normalized}`);
    assertOpenFileMemoryRead(existing);
    existing.fileType = "text";
    return existing;
  }
  return trackFileLoad(workspace, normalized, async () => {
    assertCurrentWorkspace(workspace);
    if (isExternalWritePath(normalized, workspace.generation)) throw new Error(`File operation is already in progress: ${normalized}`);
    const loaded = openFiles.get(normalized);
    if (loaded) {
      if (!isTextFileState(loaded)) throw new Error(`File is not readable text: ${normalized}`);
      assertOpenFileMemoryRead(loaded);
      return loaded;
    }

    const node = findNodeByPath(tree.value, normalized);
    if (!node || node.kind !== "file") {
      if (options.create) {
        assertFilePathAncestors(normalized);
        return createVirtualFileState(normalized, {...options, workspace});
      }
      throw new Error(`File not found: ${normalized}`);
    }
    assertReadableTextEntry(node);
    const content = await workspace.session.readText(normalized, { adoptBase: true });
    assertCurrentWorkspace(workspace);
    if (isExternalWritePath(normalized, workspace.generation)) throw new Error(`File operation is already in progress: ${normalized}`);
    const concurrent = openFiles.get(normalized);
    if (concurrent) {
      if (!isTextFileState(concurrent)) throw new Error(`File is not readable text: ${normalized}`);
      return concurrent;
    }

    const language = getLanguageId(node.name);
    const monacoLanguage = getMonacoLanguageId(language);
    const model = getOrCreateWorkspaceModel(content, monacoLanguage, node.path, true);
    workspaceModelPaths.delete(node.path);
    const fileState = { name: node.name, path: node.path, fileType: "text", model, originalModel: null, savedValue: content, lastLegalValue: content, lastStagedValue: content, dirty: false, closed: options.closed ?? true, language, monacoLanguage, isNew: false, persisted: true, deleted: false, size: node.size, mimeType: node.mimeType || getMimeType(node.path), version: node.version };
    attachTextModelListener(fileState);
    openFiles.set(node.path, fileState);
    touchDirtyState();
    return fileState;
  });
}

async function ensureAnyFileState(path, options = {}) {
  const workspace = options.workspace || captureWorkspace();
  assertCurrentWorkspace(workspace);
  const normalized = normalizeWorkspacePath(path);
  if (isExternalWritePath(normalized, workspace.generation)) throw new Error(`File operation is already in progress: ${normalized}`);
  const existing = openFiles.get(normalized);
  if (existing) {
    const nextClosed = options.closed ?? existing.closed;
    if (existing.closed !== nextClosed) {
      existing.closed = nextClosed;
      openFiles.set(normalized, existing);
      touchDirtyState();
    }
    return existing;
  }
  const node = findNodeByPath(tree.value, normalized);
  if (!node || node.kind !== "file") {
    if (options.create) return ensureFileState(normalized, {...options, workspace});
    throw new Error(`File not found: ${normalized}`);
  }
  if (isImageEntry(node)) {
    return trackFileLoad(workspace, normalized, async () => {
      const blob = await workspace.session.readBlob(normalized, { adoptBase: true });
      assertCurrentWorkspace(workspace);
      if (isExternalWritePath(normalized, workspace.generation)) throw new Error(`File operation is already in progress: ${normalized}`);
      return openFiles.get(normalized) || createImageFileState(node, blob, options);
    });
  }
  if (!isReadableTextEntry(node)) {
    assertCurrentWorkspace(workspace);
    return createUnsupportedFileState(node, options);
  }
  return ensureFileState(normalized, {...options, workspace});
}

async function createVirtualFileState(path, options = {}) {
  const workspace = options.workspace || captureWorkspace();
  if (!isCurrentWorkspace(workspace)) throw new Error("Workspace session changed");
  if (isExternalWritePath(path, workspace.generation)) throw new Error(`File operation is already in progress: ${path}`);
  assertFilePathAncestors(path);
  const name = path.split("/").pop();
  const content = String(options.content ?? "");
  const language = getLanguageId(name);
  const monacoLanguage = getMonacoLanguageId(language);
  const model = getOrCreateWorkspaceModel(content, monacoLanguage, path, true);
  workspaceModelPaths.delete(path);
  const fileState = { name, path, fileType: "text", model, originalModel: null, savedValue: "", lastLegalValue: content, lastStagedValue: "", dirty: true, closed: options.closed ?? true, language, monacoLanguage, isNew: true, persisted: false, deleted: false, size: workspace.session.fileSystem.policy.getTextSize(content), mimeType: getMimeType(path, "text/plain;charset=utf-8"), version: null };
  attachTextModelListener(fileState);
  openFiles.set(path, fileState);
  try {
    await queueFileStage(fileState, (session) => session.stageText(path, content, {
      mimeType: fileState.mimeType,
      createOnly: true,
    }), workspace);
    fileState.lastStagedValue = content;
  } catch (error) {
    if (isCurrentWorkspace(workspace)) removeFileState(path);
    throw error;
  }
  if (isCurrentWorkspace(workspace)) touchDirtyState();
  return fileState;
}

async function aiToolLoadCredentials({ path } = {}) {
  const normalized = normalizeWorkspacePath(path);
  const file = await ensureFileState(normalized, { closed: true });
  if (file.deleted) throw new Error(`File is marked for deletion: ${file.path}`);
  const result = aiCredentialStore.load(file.path, file.model.getValue());
  return { summary: `Loaded ${result.loaded_keys.length} credential Key(s) from ${file.path}`, ...result };
}

function aiToolListCredentials() {
  const credentials = aiCredentialStore.list();
  return { summary: `${credentials.length} credential Key(s) loaded`, credentials };
}

async function aiToolListFiles({ path = "", max_items: maxItems = 200, recursive = false } = {}) {
  const rawPath = String(path || "").trim();
  const normalizedPath = !rawPath || rawPath === "." ? "" : normalizeWorkspacePath(rawPath);
  const nodes = normalizedPath ? [findNodeByPath(tree.value, normalizedPath)].filter(Boolean) : tree.value;
  if (normalizedPath && !nodes.length) throw new Error(`Path not found: ${path}`);
  const limit = Math.max(1, Math.min(Number(maxItems) || 200, 1000));
  const sourceNodes = normalizedPath && nodes[0]?.kind === "directory" ? nodes[0].children || [] : nodes;
  const items = recursive ? flattenTree(nodes, limit) : listTreeLevel(sourceNodes, limit);
  return { summary: `${items.length} item(s)`, items };
}

async function aiToolRefreshTree({ collapse_all: collapseAll = false } = {}) {
  if (!rootHandle.value) throw new Error("No workspace loaded");
  await refreshTree({ collapseAll: Boolean(collapseAll) });
  const count = countTreeNodes(diskTree.value);
  return { summary: `Refreshed ${count} item(s)`, count };
}

async function aiToolReadFile({ path, offset, limit, max_chars: maxChars } = {}) {
  const file = await ensureFileState(path, { closed: true });
  const content = file.model.getValue();
  const maxLength = clampToolCharLimit(maxChars);
  const partial = getLineBasedContentSlice(content, { offset, limit, maxChars: maxLength });
  return { path: file.path, language: file.language, dirty: file.dirty, deleted: Boolean(file.deleted), ...partial };
}

async function aiToolReadImage(path) {
  const normalized = normalizeWorkspacePath(path);
  const opened = openFiles.get(normalized);
  let file;
  if (opened) {
    if (opened.fileType !== "image" || opened.deleted) throw new Error(`File is not an image: ${normalized}`);
    file = getActiveImageBlob(opened);
    if (!file) throw new Error(`Image data is unavailable: ${normalized}`);
  } else {
    const node = findNodeByPath(tree.value, normalized);
    if (!node || node.kind !== "file") throw new Error(`File not found: ${normalized}`);
    file = await fileSession.value.readBlob(normalized);
  }
  if (!FileUtils.isImageFile(new File([file], normalized.split("/").pop(), { type: file.type }))) throw new Error(`File is not an image: ${normalized}`);
  assertSpecialReadSize(normalized, file.size, AI_IMAGE_MAX_FILE_SIZE, "AI image read");
  const mimeType = FileUtils.getImageMimeType(normalized, file.type);
  const dataUrl = FileUtils.normalizeImageDataUrl(await FileUtils.readFileAsDataUrl(file), mimeType);
  return { path: normalized, mimeType, size: file.size, dataUrl };
}

async function aiToolGenerateOrEditImage({ prompt, output_path: outputPath, input_path: inputPath, mask_path: maskPath, size = "auto", quality = "auto", background = "auto", output_format: outputFormat, overwrite = false } = {}, session = getActiveAiSession(), signal) {
  const workspace = captureWorkspace();
  assertCurrentWorkspace(workspace);
  throwIfAiAborted(signal);
  const normalizedPrompt = String(prompt || "").trim();
  if (!normalizedPrompt) throw new Error("prompt is required");
  const normalizedOutputPath = normalizeWorkspacePath(outputPath);
  const format = normalizeImageOutputFormat(outputFormat, normalizedOutputPath);
  const normalizedInputPath = inputPath ? normalizeWorkspacePath(inputPath) : "";
  assertFilePathAncestors(normalizedOutputPath);
  if (isExternalWritePath(normalizedOutputPath, workspace.generation)) throw new Error(`File operation is already in progress: ${normalizedOutputPath}`);
  if (maskPath && !normalizedInputPath) throw new Error("mask_path requires input_path");
  const existingTarget = openFiles.get(normalizedOutputPath) || findNodeByPath(tree.value, normalizedOutputPath);
  if (existingTarget?.kind === "directory") throw new Error(`Output path is a directory: ${normalizedOutputPath}`);
  if (existingTarget && normalizedOutputPath !== normalizedInputPath && !overwrite) throw new Error(`File already exists: ${normalizedOutputPath}`);
  if (openFiles.get(normalizedOutputPath) && openFiles.get(normalizedOutputPath).fileType !== "image") throw new Error(`Output file is not an image: ${normalizedOutputPath}`);

  const input = normalizedInputPath ? await getWorkspaceImageSource(normalizedInputPath, { workspace }) : null;
  const mask = maskPath ? await getWorkspaceImageSource(maskPath, { mask: true, workspace }) : null;
  assertCurrentWorkspace(workspace);
  throwIfAiAborted(signal);
  if (input && mask && input.width && mask.width && (input.width !== mask.width || input.height !== mask.height)) throw new Error("mask_path dimensions must match input_path");
  const blob = await callOpenAiImage({
    prompt: normalizedPrompt,
    inputBlob: input?.blob,
    inputName: input?.name,
    maskBlob: mask?.blob,
    maskName: mask?.name,
    size: String(size || "auto"),
    quality: String(quality || "auto"),
    background: String(background || "auto"),
    outputFormat: format,
    outputPath: normalizedOutputPath,
  }, signal);
  throwIfAiAborted(signal);
  assertCurrentWorkspace(workspace);
  const dimensions = await readImageDimensions(blob);
  throwIfAiAborted(signal);
  assertCurrentWorkspace(workspace);
  const operation = input ? "edited" : "generated";
  const file = await trackFileLoad(workspace, normalizedOutputPath, () => stageImageFile({
    path: normalizedOutputPath,
    blob,
    session,
    signal,
    createOnly: !existingTarget && !overwrite,
    workspace,
  }));
  assertCurrentWorkspace(workspace);
  const summary = tr(input ? "ai.imageEdited" : "ai.imageGenerated", { path: file.path });
  setStatus(summary, tr("status.unsaved"));
  return {
    summary,
    image_path: file.path,
    input_path: input?.path || null,
    operation,
    mime_type: file.mimeType,
    size: file.size,
    width: dimensions.width,
    height: dimensions.height,
    dirty: file.dirty,
    created: file.isNew,
  };
}

function normalizeImageOutputFormat(value, path) {
  const requested = String(value || "").trim().toLowerCase().replace("jpg", "jpeg");
  const extension = FileUtils.getFileExtension(path).replace("jpg", "jpeg");
  const format = requested || extension;
  if (!["png", "jpeg", "webp"].includes(format)) throw new Error("output_path must end in .png, .jpg, .jpeg, or .webp");
  if (requested && extension !== requested) throw new Error(`output_format ${requested} does not match output_path: ${path}`);
  return format;
}

async function getWorkspaceImageSource(path, options = {}) {
  const workspace = options.workspace || captureWorkspace();
  assertCurrentWorkspace(workspace);
  const normalized = normalizeWorkspacePath(path);
  if (isExternalWritePath(normalized, workspace.generation)) throw new Error(`File operation is already in progress: ${normalized}`);
  const opened = openFiles.get(normalized);
  let blob;
  let name = normalized.split("/").pop();
  if (opened) {
    if (opened.fileType !== "image" || opened.deleted) throw new Error(`File is not an image: ${normalized}`);
    blob = getActiveImageBlob(opened);
  } else {
    const node = findNodeByPath(tree.value, normalized);
    if (!node || node.kind !== "file") throw new Error(`File not found: ${normalized}`);
    blob = await workspace.session.readBlob(normalized);
    assertCurrentWorkspace(workspace);
    name = node.name;
  }
  if (!blob || !FileUtils.isImageFile(new File([blob], name, { type: blob.type }))) throw new Error(`File is not an image: ${normalized}`);
  const mimeType = FileUtils.getImageMimeType(name, blob.type);
  if (options.mask) {
    if (mimeType !== "image/png") throw new Error(`Mask must be a PNG image: ${normalized}`);
    assertSpecialReadSize(normalized, blob.size, AI_IMAGE_MASK_MAX_FILE_SIZE, "AI image mask read");
  } else {
    if (!["image/png", "image/jpeg", "image/webp"].includes(mimeType)) throw new Error(`Image edit input must be PNG, JPEG, or WebP: ${normalized}`);
    assertSpecialReadSize(normalized, blob.size, AI_IMAGE_MAX_FILE_SIZE, "AI image input read");
  }
  const dimensions = await readImageDimensions(blob);
  assertCurrentWorkspace(workspace);
  return { path: normalized, name, blob, mimeType, ...dimensions };
}

async function readImageDimensions(blob) {
  if (!window.createImageBitmap) return { width: 0, height: 0 };
  try {
    const bitmap = await createImageBitmap(blob);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dimensions;
  } catch {
    return { width: 0, height: 0 };
  }
}

async function stageImageFile({ path, blob, session, signal, createOnly = false, activate = true, workspace = captureWorkspace() }) {
  assertCurrentWorkspace(workspace);
  assertFilePathAncestors(path);
  if (isExternalWritePath(path, workspace.generation)) throw new Error(`File operation is already in progress: ${path}`);
  throwIfAiAborted(signal);
  let file = openFiles.get(path);
  let createdState = false;
  if (!file) {
    const node = findNodeByPath(tree.value, path);
    if (node) {
      const diskFile = await trackFileLoad(workspace, path, () => workspace.session.readBlob(path, { view: "base" }));
      throwIfAiAborted(signal);
      assertCurrentWorkspace(workspace);
      if (isExternalWritePath(path, workspace.generation)) throw new Error(`File operation is already in progress: ${path}`);
      if (!FileUtils.isImageFile(diskFile)) throw new Error(`Output file is not an image: ${path}`);
      file = createImageFileState(node, diskFile, { closed: false });
    } else {
      file = createVirtualImageFileState(path, blob, workspace);
      createdState = true;
    }
  }
  throwIfAiAborted(signal);
  if (file.fileType !== "image") throw new Error(`Output file is not an image: ${path}`);
  try {
    if (file.blob !== blob || !workspace.session.hasChange(path)) {
      await stageImageFileBlob(file, blob, { createOnly, workspace });
    }
  } catch (error) {
    if (createdState) removeFileState(path);
    throw error;
  }
  file.deleted = false;
  if (activate) file.closed = false;
  else if (createdState) file.closed = true;
  if (file.isNew) file.aiCreated = true;
  markAiTouchedFile(file, session);
  updateDirtyState(file);
  if (activate) activateFile(file.path);
  return file;
}

async function stageBinaryFile({ path, blob, session, signal, workspace = captureWorkspace() }) {
  assertCurrentWorkspace(workspace);
  assertFilePathAncestors(path);
  if (isExternalWritePath(path, workspace.generation)) throw new Error(`File operation is already in progress: ${path}`);
  throwIfAiAborted(signal);
  let file = openFiles.get(path);
  let createdState = false;
  if (!file) {
    const node = findNodeByPath(tree.value, path);
    if (node) {
      if (node.kind !== "file" || isReadableTextEntry(node) || isImageEntry(node)) throw new Error(`Output file type does not match binary content: ${path}`);
      const diskFile = await trackFileLoad(workspace, path, () => workspace.session.readBlob(path, { view: "base" }));
      throwIfAiAborted(signal);
      assertCurrentWorkspace(workspace);
      file = createBinaryFileState(node, diskFile, { closed: true });
    } else {
      file = createVirtualBinaryFileState(path, blob, workspace);
      createdState = true;
    }
  } else if (file.fileType === "unsupported" && !getActiveBlobFile(file)) {
    const diskFile = await trackFileLoad(workspace, path, () => workspace.session.readBlob(path, { view: "base" }));
    throwIfAiAborted(signal);
    assertCurrentWorkspace(workspace);
    file.blob = markRaw(diskFile);
    file.savedBlob = markRaw(diskFile);
  }
  if (file.fileType !== "unsupported" || !getActiveBlobFile(file)) throw new Error(`Output file type does not match binary content: ${path}`);
  try {
    await stageBinaryFileBlob(file, blob, { createOnly: createdState, workspace });
  } catch (error) {
    if (createdState) removeFileState(path);
    throw error;
  }
  file.deleted = false;
  if (file.isNew) file.aiCreated = true;
  markAiTouchedFile(file, session);
  updateDirtyState(file);
  return file;
}

function createVirtualImageFileState(path, blob, workspace = captureWorkspace()) {
  assertCurrentWorkspace(workspace);
  assertFilePathAncestors(path);
  if (isExternalWritePath(path, workspace.generation)) throw new Error(`File operation is already in progress: ${path}`);
  const name = path.split("/").pop();
  const imageBlob = markRaw(blob);
  const fileState = { name, path, fileType: "image", blob: imageBlob, savedBlob: null, objectUrl: URL.createObjectURL(imageBlob), size: imageBlob.size, mimeType: imageBlob.type || FileUtils.getImageMimeType(name), dirty: true, closed: false, language: "plaintext", monacoLanguage: "plaintext", isNew: true, persisted: false, deleted: false, version: null };
  fileState.model = getOrCreatePreviewModel(getReadonlyPreviewContent(fileState), path);
  openFiles.set(path, fileState);
  touchDirtyState();
  return fileState;
}

function createVirtualBinaryFileState(path, blob, workspace = captureWorkspace()) {
  assertCurrentWorkspace(workspace);
  assertFilePathAncestors(path);
  if (isExternalWritePath(path, workspace.generation)) throw new Error(`File operation is already in progress: ${path}`);
  const name = path.split("/").pop();
  const binaryBlob = markRaw(blob);
  const fileState = { name, path, fileType: "unsupported", blob: binaryBlob, savedBlob: null, size: binaryBlob.size, mimeType: binaryBlob.type || getMimeType(name), dirty: true, closed: true, language: "plaintext", monacoLanguage: "plaintext", isNew: true, persisted: false, deleted: false, version: null };
  fileState.model = getOrCreatePreviewModel(getReadonlyPreviewContent(fileState), path);
  openFiles.set(path, fileState);
  touchDirtyState();
  return fileState;
}

async function aiToolReadFiles({ paths, offset, limit, max_chars_per_file: maxCharsPerFile } = {}) {
  if (!Array.isArray(paths) || !paths.length) throw new Error("paths is required");
  const maxChars = clampToolCharLimit(maxCharsPerFile);
  const files = [];
  for (const path of paths.slice(0, 20)) {
    const file = await ensureFileState(path, { closed: true });
    const content = file.model.getValue();
    files.push({ path: file.path, language: file.language, dirty: file.dirty, deleted: Boolean(file.deleted), ...getLineBasedContentSlice(content, { offset, limit, maxChars }) });
  }
  return { summary: `Read ${files.length} file(s)`, files };
}

function getLineBasedContentSlice(content, { offset, limit, maxChars }) {
  const text = String(content ?? "");
  const maxLength = clampToolCharLimit(maxChars);
  const hasLineRange = offset != null || limit != null;
  if (!hasLineRange) {
    const clipped = clipAiToolText(text, maxLength);
    return { content_chars: clipped.text_chars, returned_chars: clipped.returned_chars, truncated: clipped.truncated, content: clipped.text };
  }

  const lines = text.split(/\r?\n/);
  const totalLines = lines.length;
  const startLine = Math.max(1, Math.floor(Number(offset) || 1));
  const startIndex = Math.min(startLine - 1, totalLines);
  const maxLines = limit == null ? totalLines - startIndex : Math.max(1, Math.floor(Number(limit) || 1));
  const endIndex = Math.min(totalLines, startIndex + maxLines);
  const sliced = lines.slice(startIndex, endIndex).join("\n");
  const clipped = clipAiToolText(sliced, maxLength);
  return {
    start_line: startIndex < totalLines ? startIndex + 1 : totalLines + 1,
    end_line: endIndex,
    total_lines: totalLines,
    content_chars: sliced.length,
    returned_chars: clipped.returned_chars,
    truncated: startIndex > 0 || endIndex < totalLines || clipped.truncated,
    content: clipped.text,
  };
}

async function aiToolSearchText({ query, path = "", max_results: maxResults = 30 } = {}) {
  if (!query) throw new Error("query is required");
  const rootNodes = path ? [findNodeByPath(tree.value, normalizeWorkspacePath(path))].filter(Boolean) : tree.value;
  const fileNodes = flattenTree(rootNodes, 2000).filter((item) => item.kind === "file");
  const results = [];
  const limit = Math.max(1, Math.min(Number(maxResults) || 30, 100));
  for (const item of fileNodes) {
    if (results.length >= limit) break;
    try {
      const file = await ensureFileState(item.path, { closed: true });
      const lines = file.model.getValue().split(/\r?\n/);
      lines.forEach((line, index) => {
        if (results.length >= limit || !line.includes(query)) return;
        const clipped = clipAiToolText(line.trim(), AI_TOOL_SEARCH_LINE_MAX_CHARS);
        results.push({ path: file.path, line: index + 1, text_chars: clipped.text_chars, returned_chars: clipped.returned_chars, truncated: clipped.truncated, text: clipped.text });
      });
    } catch {
      // Ignore unreadable files during broad searches.
    }
  }
  return { summary: `${results.length} match(es)`, results };
}

async function aiToolRunJavaScript({ reason, code, entry_file: entryFile, format, resolve_from: resolveFrom, cwd, input = {}, env, args, dependencies, registry_url: registryUrl, credentials, proxy_options: proxyOptions = {}, input_files: inputFiles, output_files: outputFiles, output_directories: outputDirectories, timeout_ms: timeoutMs } = {}, signal, session = getActiveAiSession()) {
  throwIfAiAborted(signal);
  const startedAt = performance.now();
  const logs = [];
  const normalizedReason = String(reason || "").trim();
  let credentialSelection;
  let prepareNetwork;

  try {
    if (!normalizedReason) throw createAiJavaScriptError("REASON_REQUIRED", "reason is required", { phase: "preflight" });
    const hasCode = code !== undefined && code !== null;
    const rawEntryFile = String(entryFile || "").trim();
    if (hasCode === Boolean(rawEntryFile)) throw createAiJavaScriptError("INVALID_ENTRY", "Provide exactly one of code or entry_file", { phase: "preflight" });
    const script = hasCode ? String(code) : undefined;
    if (hasCode && !script.trim()) throw createAiJavaScriptError("SCRIPT_REQUIRED", "JavaScript code is required", { phase: "preflight" });
    if (hasCode && script.length > AI_JAVASCRIPT_MAX_CODE_CHARS) throw createAiJavaScriptError("SCRIPT_TOO_LARGE", `JavaScript code is too large: ${script.length} chars`, { phase: "preflight", size: script.length, maxSize: AI_JAVASCRIPT_MAX_CODE_CHARS });
    if (!window.Worker || !window.MessageChannel) throw createAiJavaScriptError("WORKER_UNAVAILABLE", "Web Worker is not available in this browser");

    const timeout = normalizeAiJavaScriptTimeout(timeoutMs);
    const normalizedFormat = normalizeAiJavaScriptFormat(format);
    const normalizedEntryFile = rawEntryFile ? normalizeAiJavaScriptPath(rawEntryFile) : "";
    const normalizedResolveFrom = normalizeAiJavaScriptDirectory(resolveFrom, "resolve_from");
    const normalizedCwd = normalizeAiJavaScriptDirectory(cwd, "cwd");
    const normalizedEnv = normalizeAiJavaScriptEnv(env);
    const normalizedArgs = normalizeAiJavaScriptArgs(args);
    const normalizedDependencies = normalizeAiJavaScriptDependencies(dependencies);
    const normalizedRegistryUrl = normalizeAiJavaScriptRegistryUrl(String(registryUrl || "").trim() || settings.ai.npmRegistryUrl);
    const normalizedInputs = normalizeAiJavaScriptInputs(inputFiles);
    const normalizedOutputFiles = normalizeAiJavaScriptOutputFiles(outputFiles);
    const normalizedOutputDirectories = normalizeAiJavaScriptOutputDirectories(outputDirectories);
    credentialSelection = aiCredentialStore.select(credentials);

    const requiresWorkspace = Boolean(normalizedEntryFile || normalizedInputs.length || normalizedOutputFiles.length || normalizedOutputDirectories.length);
    if (requiresWorkspace && !isWorkspaceLoaded()) {
      throw createAiJavaScriptError("WORKSPACE_REQUIRED", "Workspace files require an open workspace", { phase: "preflight" });
    }
    const workspace = isWorkspaceLoaded() ? captureWorkspace() : null;
    const maxReadBytes = workspace?.session?.fileSystem.policy.maxMemoryReadBytes ?? normalizeMemoryLimit(settings.maxMemoryReadBytes, DEFAULT_MAX_MEMORY_READ_BYTES);
    const maxWriteBytes = workspace?.session?.fileSystem.policy.maxMemoryWriteBytes ?? normalizeMemoryLimit(settings.maxMemoryWriteBytes, DEFAULT_MAX_MEMORY_WRITE_BYTES);
    const limits = {
      maxInputFileBytes: maxReadBytes,
      maxInputTotalBytes: maxReadBytes,
      maxDownloadBytes: maxReadBytes,
      maxDownloadTotalBytes: maxReadBytes,
      maxOutputFileBytes: maxWriteBytes,
      maxOutputTotalBytes: maxWriteBytes,
    };

    if (workspace) validateAiJavaScriptOutputDeclarations(normalizedOutputFiles, normalizedOutputDirectories, workspace);
    const loadedInputs = workspace ? await loadAiJavaScriptInputs(normalizedInputs, workspace, limits, signal) : [];
    throwIfAiAborted(signal);
    const proxy = isBackendEnabled();
    const backendBaseUrl = proxy ? getBackendBaseUrl() : "";
    const webBaseUrl = new URL(CODE_EDITOR_WEB_PATH, window.location.origin).toString();
    const requestProxy = new RequestProxy(backendBaseUrl, { baseUrl: webBaseUrl });
    prepareNetwork = new NetworkLimit(requestProxy, {
      baseUrl: webBaseUrl,
      maxRequestCount: AI_JAVASCRIPT_MAX_PREPARE_REQUEST_COUNT,
      maxResponseBytes: maxReadBytes,
      maxResponseTotalBytes: maxReadBytes,
      defaultTimeoutMs: Math.min(AI_JAVASCRIPT_DEFAULT_TIMEOUT_MS, timeout),
      maxTimeoutMs: timeout,
    });
    const prepareRunScript = await loadPrepareRunScript();
    const prepareStartedAt = performance.now();
    const prepared = await prepareRunScript({
      ...(hasCode ? { code: script } : { entryFile: normalizedEntryFile }),
      ...(normalizedFormat ? { format: normalizedFormat } : {}),
      resolveFrom: normalizedResolveFrom,
      cwd: normalizedCwd,
      input,
      env: { ...normalizedEnv, ...credentialSelection.values },
      args: normalizedArgs,
      dependencies: normalizedDependencies,
      inputFiles: loadedInputs.map((file) => ({ path: file.path, type: file.type, content: file.content, mimeType: file.mimeType })),
      signal,
    }, {
      workspace: workspace ? createAiRunScriptWorkspace(workspace) : null,
      fetch: prepareNetwork.fetch,
      registryUrl: normalizedRegistryUrl || undefined,
      limits: {
        maxSourceBytes: maxReadBytes,
        maxTotalBytes: maxReadBytes,
        maxDownloadBytes: maxReadBytes,
        maxDownloadTotalBytes: maxReadBytes,
      },
      signal,
    });
    prepareNetwork.assertHealthy();
    const prepareElapsedMs = Math.round(performance.now() - prepareStartedAt);
    if (workspace) assertCurrentWorkspace(workspace);

    const data = await runAiNodeWorker({
      prepared,
      outputFiles: normalizedOutputFiles,
      outputDirectories: normalizedOutputDirectories,
      fileLimits: {
        maxReadBytes,
        maxWriteBytes,
        maxEntryCount: Math.max(40_000, prepared.files.length * 3 + AI_JAVASCRIPT_MAX_FILE_COUNT * 3),
      },
      outputLimits: {
        maxOutputFileBytes: maxWriteBytes,
        maxOutputTotalBytes: maxWriteBytes,
        maxOutputFileCount: AI_JAVASCRIPT_MAX_FILE_COUNT,
      },
      network: {
        serverUrl: backendBaseUrl,
        baseUrl: webBaseUrl,
        useTargetOrigin: proxyOptions?.use_target_origin === true,
        useTargetReferer: proxyOptions?.use_target_referer === true,
        limits: {
          maxRequestCount: AI_JAVASCRIPT_MAX_REQUEST_COUNT,
          maxResponseBytes: maxReadBytes,
          maxResponseTotalBytes: maxReadBytes,
          defaultTimeoutMs: Math.min(AI_JAVASCRIPT_DEFAULT_TIMEOUT_MS, timeout),
          maxTimeoutMs: timeout,
        },
      },
      logging: {
        maxEntries: AI_JAVASCRIPT_MAX_LOGS,
        serialization: {
          maxStringLength: AI_TOOL_OUTPUT_DEFAULT_MAX_CHARS,
          maxCollectionItems: AI_JAVASCRIPT_MAX_RESULT_COLLECTION_ITEMS,
          maxDepth: AI_JAVASCRIPT_MAX_RESULT_DEPTH,
        },
      },
      serialization: {
        maxStringLength: AI_TOOL_OUTPUT_DEFAULT_MAX_CHARS,
        maxCollectionItems: AI_JAVASCRIPT_MAX_RESULT_COLLECTION_ITEMS,
        maxDepth: AI_JAVASCRIPT_MAX_RESULT_DEPTH,
      },
    }, {
      signal,
      timeoutMs: timeout,
      onLog: (log) => logs.push(log),
    });

    if (!data.ok) {
      return {
        ok: false,
        summary: appendAiToolPurpose(tr("ai.javascriptFailed", { message: data.error?.message || "Unknown error" }), normalizedReason),
        reason: normalizedReason,
        error: serializeAiJavaScriptError(data.error),
        recovery_hint: getAiJavaScriptFailureRecoveryHint(data.error),
        logs,
        log_stats: data.logStats,
        network: data.network,
        prepare_network: prepareNetwork.getUsage(),
        prepare_elapsed_ms: prepareElapsedMs,
        execute_elapsed_ms: data.elapsedMs || 0,
        elapsed_ms: Math.round(performance.now() - startedAt),
        requested_credentials: credentialSelection.requested,
        missing_credentials: credentialSelection.missing,
      };
    }

    if (workspace) assertCurrentWorkspace(workspace);
    const validatedOutputs = workspace
      ? validateAiJavaScriptOutputs(data.outputFiles, normalizedOutputFiles, normalizedOutputDirectories, workspace, limits)
      : [];
    const stagedFiles = workspace
      ? await stageAiJavaScriptOutputs(validatedOutputs, workspace, session, signal)
      : [];
    const filesSummary = stagedFiles.length ? tr("ai.javascriptProducedFiles", { count: stagedFiles.length }) : "";
    return {
      ok: true,
      summary: appendAiToolPurpose(tr("ai.javascriptCompleted", { elapsed: data.elapsedMs || 0, files: filesSummary }), normalizedReason),
      reason: normalizedReason,
      result: data.result,
      exit_code: data.exitCode || 0,
      entry_path: prepared.entryPath,
      format: prepared.format,
      logs,
      log_stats: data.logStats,
      network: data.network,
      prepare_network: prepareNetwork.getUsage(),
      files: stagedFiles,
      prepare_elapsed_ms: prepareElapsedMs,
      execute_elapsed_ms: data.elapsedMs || 0,
      elapsed_ms: Math.round(performance.now() - startedAt),
      requested_credentials: credentialSelection.requested,
      missing_credentials: credentialSelection.missing,
    };
  } catch (error) {
    prepareNetwork?.abortAll(error);
    if (error?.name === "AbortError") throw error;
    const errorResult = aiJavaScriptErrorResult(error);
    return {
      ...errorResult,
      summary: appendAiToolPurpose(tr("ai.javascriptFailed", { message: errorResult.summary }), normalizedReason),
      reason: normalizedReason,
      logs,
      elapsed_ms: Math.round(performance.now() - startedAt),
      requested_credentials: credentialSelection?.requested || [],
      missing_credentials: credentialSelection?.missing || [],
      prepare_network: prepareNetwork?.getUsage?.() || { requestCount: 0, responseBytes: 0 },
    };
  }
}

function loadPrepareRunScript() {
  if (!prepareRunScriptPromise) {
    prepareRunScriptPromise = import("@/shared/node-worker/run-script-preparer.js").then((module) => module.prepareRunScript).catch((error) => {
      prepareRunScriptPromise = null;
      throw error;
    });
  }
  return prepareRunScriptPromise;
}

function createAiJavaScriptError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.entries(details).forEach(([key, value]) => {
    if (value !== undefined) error[key] = value;
  });
  return error;
}

function normalizeAiJavaScriptTimeout(value) {
  if (value === undefined || value === null || value === "") return AI_JAVASCRIPT_DEFAULT_TIMEOUT_MS;
  const timeout = Number(value);
  if (!Number.isFinite(timeout) || timeout <= 0) throw createAiJavaScriptError("INVALID_TIMEOUT", "timeout_ms must be a positive finite number", { phase: "preflight" });
  return Math.min(Math.ceil(timeout), AI_JAVASCRIPT_MAX_TIMEOUT_MS);
}

function serializeAiJavaScriptError(error) {
  const source = error && typeof error === "object" ? error : {};
  const result = {
    name: source.name || "Error",
    code: source.code || "SCRIPT_ERROR",
    message: source.message || String(error),
  };
  [
    ["phase", "phase"],
    ["path", "path"],
    ["url", "url"],
    ["operation", "operation"],
    ["size", "size"],
    ["maxSize", "max_size"],
    ["requestAborted", "request_aborted"],
    ["partialFileDiscarded", "partial_file_discarded"],
    ["specifier", "specifier"],
    ["parent", "parent"],
    ["format", "format"],
    ["exitCode", "exit_code"],
    ["status", "status"],
    ["operations", "operations"],
    ["filename", "filename"],
    ["lineno", "line"],
    ["colno", "column"],
  ].forEach(([sourceKey, resultKey]) => {
    if (source[sourceKey] !== undefined) result[resultKey] = source[sourceKey];
  });
  if (source.stack) result.stack = String(source.stack).slice(0, AI_TOOL_OUTPUT_DEFAULT_MAX_CHARS);
  return result;
}

function evaluateAiJavaScriptSize({ itemSize, currentTotal = 0, itemLimit, totalLimit, phase }) {
  const size = Number(itemSize) || 0;
  const total = currentTotal + size;
  if (size > itemLimit) return { total, violation: { phase, size, maxSize: itemLimit } };
  if (total > totalLimit) return { total, violation: { phase: `${phase}-total`, size: total, maxSize: totalLimit } };
  return { total, violation: null };
}

function resolveAiJavaScriptOutputPolicy(path, outputFiles, outputDirectories) {
  const exact = outputFiles.find((item) => item.path === path);
  if (exact) return exact;
  return outputDirectories
    .filter((item) => item.path === "" ? path !== "" : path !== item.path && path.startsWith(`${item.path}/`))
    .sort((left, right) => right.path.length - left.path.length)[0] || null;
}

function getAiJavaScriptOutputConflict(existingKind, overwrite) {
  if (existingKind === "directory") return "OUTPUT_PATH_TYPE_CONFLICT";
  if (existingKind === "file" && !overwrite) return "FILE_ALREADY_EXISTS";
  return "";
}

function isAiJavaScriptTextOutput(path, type, mimeType) {
  return type === "text" || FileUtils.isTextFile({ name: path, type: mimeType });
}

function aiJavaScriptErrorResult(error) {
  const serialized = serializeAiJavaScriptError(error);
  return { ok: false, summary: serialized.message, error: serialized, recovery_hint: getAiJavaScriptFailureRecoveryHint(error), files_written: [] };
}

function getAiJavaScriptFailureRecoveryHint(error) {
  if (error?.code === "UNSUPPORTED_ESM_CYCLE") {
    return "This package's ESM graph contains a cycle that the browser runtime cannot load. If the package also exports CommonJS, retry with format commonjs and require(); otherwise explain the limitation.";
  }
  return AI_JAVASCRIPT_FAILURE_RECOVERY_HINT;
}

function normalizeAiJavaScriptArray(value, field) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw createAiJavaScriptError("INVALID_ARGUMENT", `${field} must be an array`, { phase: "preflight" });
  if (value.length > AI_JAVASCRIPT_MAX_FILE_COUNT) throw createAiJavaScriptError("FILE_COUNT_EXCEEDED", `${field} exceeds ${AI_JAVASCRIPT_MAX_FILE_COUNT} entries`, { phase: "preflight", size: value.length, maxSize: AI_JAVASCRIPT_MAX_FILE_COUNT });
  return value;
}

function normalizeAiJavaScriptPath(value, phase = "preflight") {
  const raw = String(value || "").trim();
  if (!raw) throw createAiJavaScriptError("INVALID_FILE_PATH", "File path is required", { phase, path: raw });
  if (/^(?:[\\/]|[A-Za-z]:[\\/])/.test(raw)) throw createAiJavaScriptError("INVALID_FILE_PATH", `Absolute file paths are not allowed: ${raw}`, { phase, path: raw });
  try {
    return normalizeWorkspacePath(raw);
  } catch (error) {
    if (!error.code) error.code = "INVALID_FILE_PATH";
    if (!error.phase) error.phase = phase;
    if (!error.path) error.path = raw;
    throw error;
  }
}

function normalizeAiJavaScriptDirectory(value, field) {
  const raw = String(value || "").trim();
  if (!raw || raw === ".") return "";
  try {
    return normalizeAiJavaScriptPath(raw);
  } catch (error) {
    if (!error.operation) error.operation = field;
    throw error;
  }
}

function normalizeAiJavaScriptFormat(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || raw === "auto") return raw;
  const aliases = { cjs: "commonjs", esm: "module", mjs: "module", iife: "global", script: "global" };
  const format = aliases[raw] || raw;
  if (!["commonjs", "module", "umd", "global"].includes(format)) {
    throw createAiJavaScriptError("INVALID_MODULE_FORMAT", `Unsupported module format: ${value}`, { phase: "preflight", format: raw });
  }
  return format;
}

function normalizeAiJavaScriptEnv(value) {
  if (value == null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw createAiJavaScriptError("INVALID_ARGUMENT", "env must be an object", { phase: "preflight" });
  }
  return Object.fromEntries(Object.entries(value).map(([name, item]) => [String(name), String(item ?? "")]));
}

function normalizeAiJavaScriptArgs(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw createAiJavaScriptError("INVALID_ARGUMENT", "args must be an array", { phase: "preflight" });
  if (value.length > AI_JAVASCRIPT_MAX_FILE_COUNT) {
    throw createAiJavaScriptError("ARGUMENT_COUNT_EXCEEDED", `args exceeds ${AI_JAVASCRIPT_MAX_FILE_COUNT} entries`, {
      phase: "preflight",
      size: value.length,
      maxSize: AI_JAVASCRIPT_MAX_FILE_COUNT,
    });
  }
  return value.map(String);
}

function normalizeAiJavaScriptDependencies(value) {
  const dependencies = normalizeAiJavaScriptArray(value, "dependencies").map((item) => String(item || "").trim());
  if (dependencies.some((item) => !item)) throw createAiJavaScriptError("INVALID_NPM_SPECIFIER", "dependencies entries must be non-empty npm package specifications", { phase: "preflight" });
  return [...new Set(dependencies)];
}

function normalizeAiJavaScriptRegistryUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw createAiJavaScriptError("INVALID_REGISTRY_URL", `Invalid registry_url: ${raw}`, { phase: "preflight", url: raw });
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw createAiJavaScriptError("INVALID_REGISTRY_URL", `registry_url must be an HTTP/HTTPS base URL without credentials, query, or hash: ${raw}`, { phase: "preflight", url: raw });
  }
  return url.href.replace(/\/+$/, "");
}

function createAiRunScriptWorkspace(workspace) {
  const activeSession = workspace.session;
  return {
    policy: activeSession.policy,
    async stat(path, options = {}) {
      throwIfAiAborted(options.signal);
      assertCurrentWorkspace(workspace);
      return activeSession.stat(path, options);
    },
    async list(path, options = {}) {
      throwIfAiAborted(options.signal);
      assertCurrentWorkspace(workspace);
      return activeSession.list(path, options);
    },
    async readText(path, options = {}) {
      throwIfAiAborted(options.signal);
      assertCurrentWorkspace(workspace);
      if ((options.view || "effective") === "effective") {
        const opened = openFiles.get(path);
        if (opened?.deleted) throw createAiJavaScriptError("FILE_NOT_FOUND", `File is marked for deletion: ${path}`, { phase: "prepare", path });
        if (opened && isTextFileState(opened)) {
          assertOpenFileMemoryRead(opened);
          return opened.model.getValue();
        }
      }
      return activeSession.readText(path, options);
    },
    async readBlob(path, options = {}) {
      throwIfAiAborted(options.signal);
      assertCurrentWorkspace(workspace);
      if ((options.view || "effective") === "effective") {
        const opened = openFiles.get(path);
        if (opened?.deleted) throw createAiJavaScriptError("FILE_NOT_FOUND", `File is marked for deletion: ${path}`, { phase: "prepare", path });
        if (opened && isTextFileState(opened)) {
          assertOpenFileMemoryRead(opened);
          return new Blob([opened.model.getValue()], { type: opened.mimeType || getMimeType(path, "text/plain;charset=utf-8") });
        }
        const blob = opened ? getActiveBlobFile(opened) : null;
        if (blob) {
          activeSession.policy?.assertMemoryRead(path, blob.size);
          return blob;
        }
      }
      return activeSession.readBlob(path, options);
    },
  };
}

function normalizeAiJavaScriptInputs(value) {
  const paths = new Set();
  return normalizeAiJavaScriptArray(value, "input_files").map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw createAiJavaScriptError("INVALID_ARGUMENT", "Each input_files entry must be an object", { phase: "preflight" });
    const path = normalizeAiJavaScriptPath(item.path);
    if (paths.has(path)) throw createAiJavaScriptError("DUPLICATE_FILE_PATH", `Duplicate input file: ${path}`, { phase: "preflight", path });
    paths.add(path);
    const type = String(item.type || "text").toLowerCase();
    const view = String(item.view || "effective").toLowerCase();
    if (!["text", "bytes"].includes(type)) throw createAiJavaScriptError("INVALID_FILE_TYPE", `Unsupported input type for ${path}: ${type}`, { phase: "preflight", path });
    if (!["effective", "base"].includes(view)) throw createAiJavaScriptError("INVALID_FILE_VIEW", `Unsupported input view for ${path}: ${view}`, { phase: "preflight", path });
    return { path, type, view };
  });
}

function normalizeAiJavaScriptOutputFiles(value) {
  const paths = new Set();
  return normalizeAiJavaScriptArray(value, "output_files").map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw createAiJavaScriptError("INVALID_ARGUMENT", "Each output_files entry must be an object", { phase: "preflight" });
    const path = normalizeAiJavaScriptPath(item.path);
    if (paths.has(path)) throw createAiJavaScriptError("DUPLICATE_FILE_PATH", `Duplicate output file: ${path}`, { phase: "preflight", path });
    paths.add(path);
    const type = item.type == null ? "" : String(item.type).toLowerCase();
    if (type && !["text", "bytes"].includes(type)) throw createAiJavaScriptError("INVALID_FILE_TYPE", `Unsupported output type for ${path}: ${type}`, { phase: "preflight", path });
    return { path, type, overwrite: item.overwrite === true };
  });
}

function normalizeAiJavaScriptOutputDirectories(value) {
  const paths = new Set();
  return normalizeAiJavaScriptArray(value, "output_directories").map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw createAiJavaScriptError("INVALID_ARGUMENT", "Each output_directories entry must be an object", { phase: "preflight" });
    const rawPath = String(item.path || "").trim();
    if (!rawPath) throw createAiJavaScriptError("INVALID_FILE_PATH", "output_directories path is required; use '.' for the workspace root", { phase: "preflight", path: rawPath });
    const path = rawPath === "." ? "" : normalizeAiJavaScriptPath(rawPath);
    if (paths.has(path)) throw createAiJavaScriptError("DUPLICATE_FILE_PATH", `Duplicate output directory: ${path}`, { phase: "preflight", path });
    paths.add(path);
    return { path, overwrite: item.overwrite === true };
  }).sort((left, right) => right.path.length - left.path.length);
}

function validateAiJavaScriptOutputDeclarations(outputFiles, outputDirectories, workspace) {
  assertCurrentWorkspace(workspace);
  const exactPaths = new Set(outputFiles.map((item) => item.path));
  outputDirectories.forEach((directory) => {
    if (exactPaths.has(directory.path)) throw createAiJavaScriptError("OUTPUT_PATH_CONFLICT", `Output path is declared as both file and directory: ${directory.path}`, { phase: "preflight", path: directory.path });
    const node = findNodeByPath(tree.value, directory.path);
    if (node?.kind === "file") throw createAiJavaScriptError("OUTPUT_PATH_TYPE_CONFLICT", `Output directory path is a file: ${directory.path}`, { phase: "preflight", path: directory.path });
    assertFilePathAncestors(directory.path);
  });
  outputFiles.forEach((file) => {
    const node = findNodeByPath(tree.value, file.path);
    if (node?.kind === "directory") throw createAiJavaScriptError("OUTPUT_PATH_TYPE_CONFLICT", `Output file path is a directory: ${file.path}`, { phase: "preflight", path: file.path });
    assertFilePathAncestors(file.path);
  });
}

async function loadAiJavaScriptInputs(inputs, workspace, limits, signal) {
  const loaded = [];
  let totalSize = 0;
  for (const input of inputs) {
    throwIfAiAborted(signal);
    assertCurrentWorkspace(workspace);
    const opened = openFiles.get(input.path);
    const node = findNodeByPath(tree.value, input.path) || findNodeByPath(diskTree.value, input.path);
    if (!opened && (!node || node.kind !== "file")) throw createAiJavaScriptError("FILE_NOT_FOUND", `File not found: ${input.path}`, { phase: "input", path: input.path });
    let content;
    let size;
    let mimeType;
    try {
      if (input.type === "text") {
        if (input.view === "effective") {
          const file = await ensureFileState(input.path, { closed: true, workspace });
          if (file.deleted) throw createAiJavaScriptError("FILE_NOT_FOUND", `File is marked for deletion: ${input.path}`, { phase: "input", path: input.path });
          content = file.model.getValue();
          size = workspace.session.fileSystem.policy.getTextSize(content);
          mimeType = file.mimeType || getMimeType(input.path, "text/plain;charset=utf-8");
          workspace.session.fileSystem.policy.assertMemoryRead(input.path, size);
        } else {
          content = await workspace.session.readText(input.path, { view: "base" });
          size = workspace.session.fileSystem.policy.getTextSize(content);
          mimeType = getMimeType(input.path, "text/plain;charset=utf-8");
        }
      } else {
        const blob = await readAiJavaScriptInputBlob(input.path, input.view, workspace);
        size = blob.size;
        mimeType = blob.type || getMimeType(input.path);
        content = await blob.arrayBuffer();
      }
    } catch (error) {
      if (error?.code === FileTooLargeError.code && !error.phase) error.phase = "input";
      throw error;
    }
    const budget = evaluateAiJavaScriptSize({ itemSize: size, currentTotal: totalSize, itemLimit: limits.maxInputFileBytes, totalLimit: limits.maxInputTotalBytes, phase: "input" });
    totalSize = budget.total;
    if (budget.violation) throw new FileTooLargeError(input.path, { ...budget.violation, operation: budget.violation.phase === "input" ? "run_javascript input" : "run_javascript total input" });
    loaded.push({ ...input, content, size, mimeType });
  }
  return loaded;
}

async function readAiJavaScriptInputBlob(path, view, workspace) {
  assertCurrentWorkspace(workspace);
  if (view === "base") return workspace.session.readBlob(path, { view: "base" });
  const opened = openFiles.get(path);
  if (opened) {
    if (opened.deleted) throw createAiJavaScriptError("FILE_NOT_FOUND", `File is marked for deletion: ${path}`, { phase: "input", path });
    if (isTextFileState(opened)) {
      assertOpenFileMemoryRead(opened);
      return new Blob([opened.model.getValue()], { type: opened.mimeType || getMimeType(path, "text/plain;charset=utf-8") });
    }
    const blob = getActiveBlobFile(opened);
    if (blob) {
      workspace.session.fileSystem.policy.assertMemoryRead(path, blob.size);
      return blob;
    }
  }
  const node = findNodeByPath(tree.value, path);
  if (!node || node.kind !== "file") throw createAiJavaScriptError("FILE_NOT_FOUND", `File not found: ${path}`, { phase: "input", path });
  return workspace.session.readBlob(path, { view: "effective" });
}

function getAiJavaScriptExistingPath(path) {
  const file = openFiles.get(path);
  const node = findNodeByPath(tree.value, path) || findNodeByPath(diskTree.value, path);
  if (node?.kind === "directory") return { exists: true, kind: "directory", file, node };
  if (file || node?.kind === "file") return { exists: true, kind: "file", file, node };
  return { exists: false, kind: "", file: null, node: null };
}

function validateAiJavaScriptOutputs(workerOutputs, outputFiles, outputDirectories, workspace, limits) {
  assertCurrentWorkspace(workspace);
  if (!Array.isArray(workerOutputs)) throw createAiJavaScriptError("INVALID_WORKER_OUTPUT", "Worker output_files must be an array", { phase: "output" });
  if (workerOutputs.length > AI_JAVASCRIPT_MAX_FILE_COUNT) throw createAiJavaScriptError("OUTPUT_FILE_COUNT_EXCEEDED", `Output exceeds ${AI_JAVASCRIPT_MAX_FILE_COUNT} files`, { phase: "output", size: workerOutputs.length, maxSize: AI_JAVASCRIPT_MAX_FILE_COUNT });
  const paths = new Set();
  const validated = [];
  let totalSize = 0;
  for (const output of workerOutputs) {
    if (!output || typeof output !== "object") throw createAiJavaScriptError("INVALID_WORKER_OUTPUT", "Invalid Worker output file", { phase: "output" });
    const path = normalizeAiJavaScriptPath(output.path, "output");
    if (paths.has(path)) throw createAiJavaScriptError("DUPLICATE_FILE_PATH", `Duplicate Worker output: ${path}`, { phase: "output", path });
    paths.add(path);
    const declaration = resolveAiJavaScriptOutputPolicy(path, outputFiles, outputDirectories);
    if (!declaration) throw createAiJavaScriptError("OUTPUT_PATH_NOT_DECLARED", `Output path is not declared: ${path}`, { phase: "output", path });
    const type = String(output.type || "").toLowerCase();
    if (!["text", "bytes"].includes(type)) throw createAiJavaScriptError("INVALID_FILE_TYPE", `Invalid output type for ${path}: ${type}`, { phase: "output", path });
    if (declaration.type && declaration.type !== type) throw createAiJavaScriptError("OUTPUT_TYPE_CONFLICT", `Output type does not match declaration: ${path}`, { phase: "output", path });
    let content;
    let size;
    let mimeType = String(output.mimeType || getMimeType(path, type === "text" ? "text/plain;charset=utf-8" : "application/octet-stream"));
    if (type === "text") {
      content = String(output.content ?? "");
      size = workspace.session.fileSystem.policy.getTextSize(content);
    } else {
      if (!(output.content instanceof Uint8Array) && !(output.content instanceof ArrayBuffer)) throw createAiJavaScriptError("INVALID_BINARY_DATA", `Invalid binary output: ${path}`, { phase: "output", path });
      content = output.content instanceof Uint8Array ? output.content : new Uint8Array(output.content);
      size = content.byteLength;
    }
    const budget = evaluateAiJavaScriptSize({ itemSize: size, currentTotal: totalSize, itemLimit: limits.maxOutputFileBytes, totalLimit: limits.maxOutputTotalBytes, phase: "output" });
    totalSize = budget.total;
    if (budget.violation) throw new FileTooLargeError(path, { ...budget.violation, operation: budget.violation.phase === "output" ? "run_javascript output" : "run_javascript total output" });
    const existing = getAiJavaScriptExistingPath(path);
    const conflict = getAiJavaScriptOutputConflict(existing.kind, declaration.overwrite === true);
    if (conflict === "OUTPUT_PATH_TYPE_CONFLICT") throw createAiJavaScriptError(conflict, `Output file path is a directory: ${path}`, { phase: "output", path });
    if (conflict === "FILE_ALREADY_EXISTS") throw createAiJavaScriptError(conflict, `Output file already exists: ${path}`, { phase: "output", path });
    const textOutput = isAiJavaScriptTextOutput(path, type, mimeType);
    if (existing.exists && textOutput && existing.file && !isTextFileState(existing.file)) throw createAiJavaScriptError("OUTPUT_TYPE_CONFLICT", `Existing output file is not text: ${path}`, { phase: "output", path });
    if (existing.exists && textOutput && !existing.file && existing.node && !isReadableTextEntry(existing.node)) throw createAiJavaScriptError("OUTPUT_TYPE_CONFLICT", `Existing output file is not text: ${path}`, { phase: "output", path });
    if (existing.exists && !textOutput && existing.file && isTextFileState(existing.file)) throw createAiJavaScriptError("OUTPUT_TYPE_CONFLICT", `Existing output file is text: ${path}`, { phase: "output", path });
    if (existing.exists && !textOutput && !existing.file && existing.node && isReadableTextEntry(existing.node)) throw createAiJavaScriptError("OUTPUT_TYPE_CONFLICT", `Existing output file is text: ${path}`, { phase: "output", path });
    if (existing.exists && type === "bytes" && !textOutput) {
      const existingIsImage = existing.file?.fileType === "image" || (!existing.file && isImageEntry(existing.node));
      const outputIsImage = FileUtils.isImageFile({ name: path, type: mimeType });
      if (existingIsImage !== outputIsImage) throw createAiJavaScriptError("OUTPUT_TYPE_CONFLICT", `Existing output file binary type does not match: ${path}`, { phase: "output", path });
    }
    validated.push({ path, type, content, size, mimeType, textOutput, overwrite: declaration.overwrite === true, created: !existing.exists });
  }
  validated.forEach((output) => {
    let parent = getParentFilePath(output.path);
    while (parent) {
      if (paths.has(parent)) throw createAiJavaScriptError("OUTPUT_PATH_TYPE_CONFLICT", `Output file is also a parent path: ${parent}`, { phase: "output", path: parent });
      if (getAiJavaScriptExistingPath(parent).kind === "file") throw createAiJavaScriptError("OUTPUT_PATH_TYPE_CONFLICT", `Output parent path is a file: ${parent}`, { phase: "output", path: parent });
      parent = getParentFilePath(parent);
    }
  });
  return validated;
}

async function stageAiJavaScriptOutputs(outputs, workspace, session, signal) {
  const files = [];
  for (const output of outputs) {
    throwIfAiAborted(signal);
    assertCurrentWorkspace(workspace);
    let file;
    if (output.textOutput) {
      const content = output.type === "text"
        ? output.content
        : await FileUtils.blobToText(new Blob([output.content], { type: output.mimeType }));
      const result = await aiToolWriteFile({ path: output.path, content }, session);
      files.push({ path: output.path, type: output.type, size: output.size, mime_type: output.mimeType, created: result.created, dirty: result.dirty });
      continue;
    }
    const blob = new Blob([output.content], { type: output.mimeType });
    if (FileUtils.isImageFile({ name: output.path, type: output.mimeType })) {
      file = await stageImageFile({ path: output.path, blob, session, signal, createOnly: output.created, activate: false, workspace });
    } else {
      file = await stageBinaryFile({ path: output.path, blob, session, signal, workspace });
    }
    files.push({ path: output.path, type: "bytes", size: output.size, mime_type: output.mimeType, created: output.created, dirty: file.dirty });
  }
  return files;
}

async function aiToolRequestProxy({ url, method = "GET", headers = {}, body, credentials, proxy_options: proxyOptions = {}, include_headers: includeHeaders = false, filter_script: filterScript, max_chars: maxChars } = {}, signal) {
  throwIfAiAborted(signal);
  validateBackendEnabled();
  if (!url) throw new Error("url is required");
  const credentialSelection = aiCredentialStore.select(credentials);
  try {
    const resolvedUrl = aiCredentialStore.resolveTemplate(url, credentialSelection);
    const resolvedHeaders = Object.fromEntries(Object.entries(headers || {}).map(([name, value]) => [name, aiCredentialStore.resolveTemplate(value, credentialSelection)]));
    const resolvedBody = body == null ? body : aiCredentialStore.resolveTemplate(body, credentialSelection);
    const target = new URL(resolvedUrl);
    if (!["http:", "https:"].includes(target.protocol)) throw new Error("Only http and https URLs are supported");
    const requestMethod = String(method || "GET").trim().toUpperCase();
    if ((requestMethod === "GET" || requestMethod === "HEAD") && resolvedBody != null) throw new Error(`${requestMethod} requests cannot include a body`);

    const outputLimit = clampToolCharLimit(maxChars);
    const followRedirect = proxyOptions?.follow_redirect !== false;
    const enableCors = proxyOptions?.enable_cors !== false;
    const requestProxy = new RequestProxy(getBackendBaseUrl(), {
      enableCors,
      useTargetOrigin: proxyOptions?.use_target_origin === true,
      useTargetReferer: proxyOptions?.use_target_referer === true,
    });
    const response = await requestProxy.fetch(target, {
      method: requestMethod,
      headers: resolvedHeaders,
      body: requestMethod === "GET" || requestMethod === "HEAD" ? undefined : String(resolvedBody ?? ""),
      credentials: "omit",
      redirect: followRedirect ? "follow" : "manual",
      signal,
    });
    const text = await response.text();
    const responseHeaders = Object.fromEntries(response.headers);
    const contentType = response.headers.get("content-type") || "";
    const filterScriptText = String(filterScript || "").trim();
    const filtered = Boolean(filterScriptText);
    let clipped = clipAiToolText(text, outputLimit);
    let filterElapsedMs = 0;

    if (filtered) {
      const filterStartedAt = performance.now();
      clipped = await runFilterScript(filterScriptText, text, {
        maxChars: outputLimit,
        timeoutMs: AI_JAVASCRIPT_DEFAULT_TIMEOUT_MS,
        signal,
      });
      filterElapsedMs = Math.round(performance.now() - filterStartedAt);
    }

    const result = {
      ok: response.ok,
      summary: `${requestMethod} ${String(url)} -> ${response.status} (${clipped.returned_chars}/${clipped.text_chars} chars${filtered ? `, filtered from ${text.length} chars` : ""})`,
      url: String(url),
      status: response.status,
      status_text: response.statusText,
      http_ok: response.ok,
      content_type: contentType,
      filtered,
      requested_credentials: credentialSelection.requested,
      missing_credentials: credentialSelection.missing,
      body_chars: clipped.text_chars,
      returned_chars: clipped.returned_chars,
      truncated: clipped.truncated,
      body: clipped.text,
    };
    if (filtered) {
      result.source_body_chars = text.length;
      result.filter_elapsed_ms = filterElapsedMs;
    }
    if (includeHeaders) result.headers = responseHeaders;
    return result;
  } catch (error) {
    throw error;
  }
}

function clampToolCharLimit(value, defaultValue = AI_TOOL_OUTPUT_DEFAULT_MAX_CHARS, maxValue = AI_TOOL_OUTPUT_HARD_MAX_CHARS) {
  return Math.max(AI_TOOL_OUTPUT_MIN_CHARS, Math.min(Number(value) || defaultValue, maxValue));
}

function aiToolGetSshConnections() {
  const connections = getAiExposedSshConfigs().map((connection) => ({
    id: connection.id,
    name: connection.name,
    host: connection.host,
    port: connection.port || 22,
    username: connection.username,
    active: isSshConnected(connection.id),
    whitelist: connection.whitelist || [],
  }));
  return { summary: `${connections.length} SSH connection(s) exposed to AI`, connections };
}

async function aiToolOpenSshConnection(identifier) {
  const config = getAiExposedSshConfig(identifier);
  const session = await connectSshConfig(config);
  await waitForSshSessionConnected(session);
  return { summary: `Opened SSH connection ${config.name || config.host}`, connection: formatAiSshConnection(config, session) };
}

async function waitForSshSessionConnected(session, timeoutMs = SSH_CONNECT_TIMEOUT_MS) {
  if (!session) throw new Error(tr("ssh.disconnected"));
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (session.connected) return session;
    if (session.connectFailed) throw new Error(session.failureReason || tr("ssh.connectFailed"));
    if (session.closing || session.ws?.readyState === WebSocket.CLOSED) throw new Error(tr("ssh.disconnected"));
    await delay(100);
  }
  throw new Error(tr("ssh.connectFailed"));
}

function aiToolActivateSshTerminal(identifier) {
  const config = getAiExposedSshConfig(identifier);
  const session = getActiveSshSessionForConfig(config);
  activateSshTerminal(config.id);
  return { summary: `Activated SSH terminal ${config.name || config.host}`, connection: formatAiSshConnection(config, session) };
}

function aiToolCloseSshConnection(identifier) {
  const config = getAiExposedSshConfig(identifier);
  disconnectSshConfig(config.id);
  return { summary: `Closed SSH connection ${config.name || config.host}`, connection: formatAiSshConnection(config, sshSessions.get(config.id)) };
}

function aiToolReadSshOutput({ connection, max_chars: maxChars } = {}) {
  const config = getAiExposedSshConfig(connection);
  const session = getActiveSshSessionForConfig(config);
  const clipped = clipAiToolTailText(sanitizeAiTerminalOutput(session.output), maxChars);
  return { summary: `Read ${clipped.returned_chars}/${clipped.text_chars} SSH output chars from ${config.name || config.host}`, connection: formatAiSshConnection(config, session), output_chars: clipped.text_chars, returned_chars: clipped.returned_chars, truncated: clipped.truncated, output: clipped.text };
}

async function aiToolSftpUploadFile({ connection, local_path: localPath, remote_path: remotePath, use_unsaved: useUnsaved = true } = {}) {
  const config = getAiExposedSshConfig(connection);
  return submitSftpUpload(config, { localPath, remotePath, useUnsaved });
}

async function aiToolSftpDownloadFile({ connection, remote_path: remotePath, local_path: localPath } = {}) {
  const config = getAiExposedSshConfig(connection);
  return submitSftpDownload(config, { localPath, remotePath });
}

function aiToolSftpListTasks({ status } = {}) {
  const normalizedStatus = String(status || "").trim().toLowerCase();
  const tasks = sftpTasks
    .filter((task) => !normalizedStatus || task.status === normalizedStatus)
    .map((task) => formatSftpTaskForTool(task, `${task.type} ${task.status}`));
  return { summary: `${tasks.length} SFTP task(s)`, tasks };
}

function aiToolSftpCancelTask({ task_id: taskId } = {}) {
  const task = sftpTasks.find((item) => item.id === String(taskId || ""));
  if (!task) throw new Error(`SFTP task not found: ${taskId}`);
  if (!canCancelSftpTask(task)) return { ...formatSftpTaskForTool(task, "SFTP task is not running"), cancelled: false };
  const cancelled = cancelSftpTask(task.id);
  return { ...formatSftpTaskForTool(task, cancelled ? "SFTP task cancelled" : "SFTP task was not cancelled"), cancelled };
}

async function aiToolExecuteSshCommand({ connection, command, commands, high_risk: highRisk, reason } = {}, signal) {
  const config = getAiExposedSshConfig(connection);
  const session = getActiveSshSessionForConfig(config);
  const normalizedCommand = String(command || "").trim();
  const mainCommands = normalizeAiSshCommandList(commands);
  const normalizedReason = String(reason || "").trim();
  if (!normalizedCommand) throw new Error("command is required");
  if (!mainCommands.length) throw new Error(tr("ssh.error.commandListRequired"));
  if (typeof highRisk !== "boolean") throw new Error("high_risk is required");
  if (!normalizedReason) throw new Error(tr("ssh.error.commandReasonRequired"));
  await authorizeAiSshCommand(config, normalizedCommand, mainCommands, highRisk, normalizedReason);
  throwIfAiAborted(signal);
  const capture = { output: "" };
  session.aiCommandCaptures.add(capture);
  try {
    sendSshCommand(session, normalizedCommand);
    await delay(SSH_COMMAND_OUTPUT_WAIT_MS);
    const clipped = clipAiToolTailText(sanitizeAiTerminalOutput(capture.output));
    return { summary: tr("ssh.toolExecutedCommand", { command: normalizedCommand, reason: normalizedReason }), connection: formatAiSshConnection(config, session), command: normalizedCommand, commands: mainCommands, high_risk: highRisk, reason: normalizedReason, output_chars: clipped.text_chars, returned_chars: clipped.returned_chars, truncated: clipped.truncated, output: clipped.text };
  } finally {
    session.aiCommandCaptures.delete(capture);
  }
}

function getAiExposedSshConfig(identifier) {
  const value = String(identifier || "").trim();
  const config = getAiExposedSshConfigs().find((connection) => connection.id === value || connection.name === value || connection.host === value);
  if (!config) throw new Error(tr("ssh.error.notExposed"));
  return config;
}

function getActiveSshSessionForConfig(config) {
  const session = sshSessions.get(config.id);
  if (!session?.connected) throw new Error(tr("ssh.disconnected"));
  return session;
}

function formatAiSshConnection(config, session) {
  return { id: config.id, name: config.name, host: config.host, port: config.port || 22, username: config.username, active: Boolean(session?.connected), whitelist: config.whitelist || [] };
}

async function authorizeAiSshCommand(config, command, mainCommands, highRisk, reason) {
  const whitelisted = areSshMainCommandsWhitelisted(config, mainCommands);
  if (!highRisk && whitelisted) return;
  const messageKey = highRisk ? "ssh.confirmHighRiskCommand" : "ssh.confirmUnauthorizedCommand";
  const approved = await showConfirm(tr(messageKey, { name: config.name || config.host, command, commands: mainCommands.join(", "), reason }), { title: tr("ssh.run"), tone: "danger", closeOnBackdrop: false });
  if (!approved) throw new Error(tr("ssh.error.commandRejected"));
}

function areSshMainCommandsWhitelisted(config, mainCommands) {
  const whitelist = new Set(normalizeSshWhitelist(config.whitelist || []).map(normalizeMainCommandName));
  return mainCommands.length > 0 && mainCommands.every((command) => whitelist.has(command));
}

function normalizeAiSshCommandList(commands) {
  if (!Array.isArray(commands)) return [];
  return uniqueStrings(commands.map(normalizeMainCommandName)).filter(Boolean);
}

function normalizeMainCommandName(command) {
  const value = String(command || "").trim();
  if (!value || /\s/.test(value)) return "";
  return value;
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function aiToolGetCurrentFile() {
  const file = activeFile.value;
  if (!file) return { summary: "No active file" };
  const selection = editor.value?.getSelection();
  const selectedText = selection && isTextFileState(file) ? file.model.getValueInRange(selection) : "";
  const clipped = clipAiToolText(selectedText);
  return { path: file.path, language: file.language, file_type: file.fileType, dirty: file.dirty, deleted: Boolean(file.deleted), position: isTextFileState(file) ? editor.value?.getPosition() : null, selection_chars: clipped.text_chars, returned_chars: clipped.returned_chars, truncated: clipped.truncated, selection: clipped.text };
}

async function aiToolReplaceInFile({ path, old_text: oldText, new_text: newText }, session = getActiveAiSession()) {
  if (!oldText) throw new Error("old_text is required");
  const file = await ensureFileState(path, { closed: true });
  if (file.deleted) throw new Error(`File is marked for deletion: ${file.path}`);
  const content = file.model.getValue();
  const index = content.indexOf(oldText);
  if (index === -1) throw new Error(`Text not found in ${file.path}`);
  await replaceTextFileContent(file, `${content.slice(0, index)}${newText}${content.slice(index + oldText.length)}`);
  markAiTouchedFile(file, session);
  updateDirtyState(file);
  setStatus(tr("status.aiChangedFile", { path: file.path }), tr("status.unsaved"));
  return { summary: `Changed ${file.path}`, path: file.path, dirty: file.dirty };
}

async function aiToolReplaceInFiles({ edits } = {}, session = getActiveAiSession()) {
  if (!Array.isArray(edits) || !edits.length) throw new Error("edits is required");
  const results = [];
  for (const [index, edit] of edits.slice(0, 50).map((edit, index) => [index, edit])) {
    const editNumber = index + 1;
    try {
      results.push({ index, edit_number: editNumber, ok: true, ...(await aiToolReplaceInFile(edit, session)) });
    } catch (error) {
      results.push({
        index,
        edit_number: editNumber,
        ok: false,
        path: edit?.path || null,
        error: error.message || String(error),
      });
    }
  }
  const applied = results.filter((result) => result.ok).length;
  const failed = results.length - applied;
  const failedEditNumbers = results.filter((result) => !result.ok).map((result) => result.edit_number);
  return { summary: `Applied ${applied}/${results.length} edit(s)${failed ? `; failed edit(s): ${failedEditNumbers.join(", ")}` : ""}`, applied, failed, failed_edit_numbers: failedEditNumbers, results };
}

async function aiToolWriteFile({ path, content }, session = getActiveAiSession()) {
  const file = await ensureFileState(path, { closed: true, create: true });
  const created = Boolean(file.isNew);
  markAiTouchedFile(file, session);
  if (created) file.aiCreated = true;
  file.deleted = false;
  await replaceTextFileContent(file, String(content ?? ""));
  setStatus(tr("status.aiChangedFile", { path: file.path }), tr("status.unsaved"));
  return { summary: `${created ? "Created" : "Changed"} ${file.path}`, path: file.path, dirty: file.dirty, created };
}

async function aiToolDeleteFile(path, session = getActiveAiSession()) {
  const normalized = normalizeWorkspacePath(path);
  const wasUnsavedNew = Boolean(openFiles.get(normalized)?.isNew && !openFiles.get(normalized)?.persisted);
  const deletedFile = await markFileDeleted(normalized, { closed: true });
  if (wasUnsavedNew) {
    setStatus(tr("status.deleted", { path: normalized }), tr("status.unsaved"));
    return { summary: `Removed unsaved new file ${normalized}`, path: normalized, deleted: true, pending: false };
  }
  markAiTouchedFile(deletedFile, session);
  return { summary: `Marked ${deletedFile.path} for deletion`, path: deletedFile.path, deleted: true, pending: true, dirty: deletedFile.dirty };
}

async function aiToolOpenFile(path) {
  const file = await ensureAnyFileState(path, { closed: false });
  file.closed = false;
  activateFile(file.path);
  return { summary: `Opened ${file.path}`, path: file.path };
}

async function aiToolShowDiff(path) {
  const file = await ensureAnyFileState(path, { closed: true });
  activateDiff(file.path);
  return { summary: `Showing diff for ${file.path}`, path: file.path, file_type: file.fileType, dirty: file.dirty };
}

async function markFileDeleted(path, options = {}, workspace = captureWorkspace()) {
  if (!isCurrentWorkspace(workspace)) throw new Error("Workspace session changed");
  const file = await ensureAnyFileState(path, { closed: options.closed ?? true, workspace });
  if (!isCurrentWorkspace(workspace)) throw new Error("Workspace session changed");
  await awaitLatestStage(file).catch(() => {});
  if (!isCurrentWorkspace(workspace)) throw new Error("Workspace session changed");
  if (file.isNew && !file.persisted) {
    workspace.session.revert(file.path);
    removeFileState(file.path);
    return file;
  }
  file.deleted = true;
  try {
    await queueFileStage(file, (session) => session.stageDelete(file.path), workspace);
  } catch (error) {
    if (isCurrentWorkspace(workspace)) {
      file.deleted = false;
      updateDirtyState(file);
    }
    throw error;
  }
  if (!isCurrentWorkspace(workspace)) return file;
  file.isNew = false;
  file.closed = options.closed ?? file.closed;
  if (isTextFileState(file)) {
    file.suppressStage = true;
    file.model.setValue("");
    file.suppressStage = false;
  }
  else refreshReadonlyPreviewModel(file);
  file.dirty = true;
  openFiles.set(file.path, file);
  touchDirtyState();
  if (activePath.value === file.path && !activeDiffPath.value) activateDiff(file.path);
  setStatus(tr("status.pendingDelete", { path: file.path }), tr("status.unsaved"));
  return file;
}

async function createFileOnDisk(path, workspace = captureWorkspace()) {
  const normalized = normalizeWorkspacePath(path);
  if (!isCurrentWorkspace(workspace)) throw new Error("Workspace session changed");
  if (isExternalWritePath(normalized, workspace.generation)) throw new Error(`File operation is already in progress: ${normalized}`);
  await workspace.session.fileSystem.writeText(normalized, "", {
    expectedVersion: null,
    createParents: true,
    mimeType: getMimeType(normalized, "text/plain;charset=utf-8"),
  });
}

function getOpenFilesUnderPath(path) {
  return Array.from(openFiles.values()).filter((file) => file.path === path || file.path.startsWith(`${path}/`));
}

function closeOpenFilesUnderPath(path) {
  getOpenFilesUnderPath(path).forEach((file) => {
    fileSession.value?.revert(file.path);
    closePreview(file.path);
    disposeFileModels(file, { force: true });
    openFiles.delete(file.path);
  });
  if (activePath.value === path || activePath.value.startsWith(`${path}/`)) {
    activateLastOpenFile(path);
  }
}

function disposeFileModels(file, { force = false } = {}) {
  if (file.objectUrl) {
    URL.revokeObjectURL(file.objectUrl);
    file.objectUrl = "";
  }
  const currentDiffModel = diffEditor.value?.getModel?.();
  if (currentDiffModel && (currentDiffModel.original === file.originalModel || currentDiffModel.modified === file.model)) {
    diffEditor.value.setModel(null);
  }
  if (editor.value?.getModel?.() === file.model) editor.value.setModel(null);
  file.modelContentDisposable?.dispose();
  if (force || !workspaceModelPaths.has(file.path)) {
    file.model?.dispose();
    workspaceModelPaths.delete(file.path);
  }
  file.originalModel?.dispose();
}

function countTreeNodes(nodes) {
  return nodes.reduce((total, node) => total + 1 + countTreeNodes(node.children || []), 0);
}

function getLanguageId(fileName) {
  const name = String(fileName || "").split(/[\\/]/).pop().toLowerCase();
  const extension = FileUtils.getFileExtension(name);
  const index = getMonacoLanguageIndex();
  return index.byFileName.get(name) || index.byExtension.get(extension) || "plaintext";
}

function getLanguageLabel(languageId) {
  const language = languageOptions.find((item) => item.id === languageId);
  return language?.labelKey ? tr(language.labelKey) : language?.label || languageId;
}

function getMonacoLanguageId(languageId) {
  if (getMonacoLanguageIndex().ids.has(languageId)) return languageId;
  return "plaintext";
}

function getMonacoLanguageIndex() {
  if (monacoLanguageIndex) return monacoLanguageIndex;
  if (!monaco?.languages?.getLanguages) return { byExtension: new Map(), byFileName: new Map(), ids: new Set() };
  const byExtension = new Map();
  const byFileName = new Map();
  const ids = new Set();
  monaco?.languages?.getLanguages?.().forEach((language) => {
    ids.add(language.id);
    (language.extensions || []).forEach((extension) => byExtension.set(extension.replace(/^\./, "").toLowerCase(), language.id));
    (language.filenames || []).forEach((fileName) => byFileName.set(fileName.toLowerCase(), language.id));
  });
  monacoLanguageIndex = { byExtension, byFileName, ids };
  return monacoLanguageIndex;
}

function getTreeIconClass(node, collapsed = false) {
  if (node.kind === "directory") return collapsed ? "folder-icon codicon-folder" : "folder-icon codicon-folder-opened";
  const language = getLanguageId(node.name);
  const icons = { bat: "file-terminal codicon-terminal-cmd", c: "file-js codicon-file-code", cpp: "file-js codicon-file-code", csharp: "file-js codicon-symbol-class", css: "file-css codicon-symbol-color", dockerfile: "file-terminal codicon-package", go: "file-go codicon-symbol-method", graphql: "file-json codicon-graph", html: "file-html codicon-code", ini: "file-json codicon-settings", java: "file-js codicon-symbol-class", javascript: "file-js codicon-symbol-method", json: "file-json codicon-json", markdown: "file-md codicon-markdown", php: "file-js codicon-file-code", powershell: "file-terminal codicon-terminal-powershell", python: "file-py codicon-file-code", ruby: "file-rust codicon-ruby", rust: "file-rust codicon-symbol-namespace", scss: "file-scss codicon-symbol-color", shell: "file-terminal codicon-terminal-bash", sql: "file-db codicon-database", typescript: "file-ts codicon-symbol-method", xml: "file-html codicon-code", yaml: "file-yaml codicon-symbol-key" };
  return icons[language] || "codicon-file";
}
</script>

<style>
.code-editor-view.app-shell {
  color-scheme: dark;
  --activity: #181818;
  --button: #333333;
  --button-hover: #3c3c3c;
  --button-hover-border: #555555;
  --panel: #252526;
  --panel-soft: #2d2d30;
  --editor: #1e1e1e;
  --tab: #2d2d2d;
  --tab-active: #1e1e1e;
  --border: #3c3c3c;
  --text: #cccccc;
  --muted: #8f8f8f;
  --accent: #007acc;
  --accent-strong: #3794ff;
  --status: #007acc;
  --status-text: #ffffff;
  --status-control-bg: rgb(255 255 255 / 14%);
  --status-control-hover: rgb(255 255 255 / 24%);
  --status-control-border: rgb(255 255 255 / 35%);
  --input: #1f1f1f;
  --context-hover: #094771;
  --shadow: rgb(0 0 0 / 40%);
  --folder-icon: #dcb67a;
  --file-icon: #c5c5c5;
  --preview-pane-size: min(var(--preview-pane-width, 480px), calc(100% - 160px));
  --scrollbar-size: 10px;
  --scrollbar-track: #1e1e1e;
  --scrollbar-thumb: #4a4a4a;
  --scrollbar-thumb-hover: #6a6a6a;
  --scrollbar-thumb-active: var(--accent);
  --scrollbar-radius: 999px;
  display: grid;
  grid-template-columns: 48px minmax(0, var(--side-panel-width, 300px)) minmax(0, 1fr);
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  background: var(--editor);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.code-editor-view.theme-vs {
  color-scheme: light;
  --activity: #f3f3f3;
  --button: #f6f6f6;
  --button-hover: #e8e8e8;
  --button-hover-border: #c8c8c8;
  --panel: #f8f8f8;
  --panel-soft: #ffffff;
  --editor: #ffffff;
  --tab: #ececec;
  --tab-active: #ffffff;
  --border: #d0d0d0;
  --text: #1f1f1f;
  --muted: #616161;
  --accent: #006ab1;
  --accent-strong: #006ab1;
  --status: #007acc;
  --status-text: #ffffff;
  --status-control-bg: rgb(255 255 255 / 16%);
  --status-control-hover: rgb(255 255 255 / 26%);
  --status-control-border: rgb(255 255 255 / 38%);
  --input: #ffffff;
  --context-hover: #dbeeff;
  --shadow: rgb(0 0 0 / 18%);
  --folder-icon: #c18401;
  --file-icon: #424242;
  --scrollbar-track: #f3f3f3;
  --scrollbar-thumb: #c8c8c8;
  --scrollbar-thumb-hover: #9f9f9f;
  --scrollbar-thumb-active: var(--accent);
}

.code-editor-view.theme-hc-black {
  color-scheme: dark;
  --activity: #000000;
  --button: #000000;
  --button-hover: #1a1a1a;
  --button-hover-border: #ffffff;
  --panel: #000000;
  --panel-soft: #050505;
  --editor: #000000;
  --tab: #000000;
  --tab-active: #000000;
  --border: #6fc3df;
  --text: #ffffff;
  --muted: #d7d7d7;
  --accent: #ffff00;
  --accent-strong: #ffff00;
  --status: #000000;
  --status-text: #ffffff;
  --status-control-bg: #000000;
  --status-control-hover: #1a1a1a;
  --status-control-border: #ffff00;
  --input: #000000;
  --context-hover: #1f4f99;
  --shadow: rgb(255 255 255 / 24%);
  --folder-icon: #ffff00;
  --file-icon: #ffffff;
  --scrollbar-track: #000000;
  --scrollbar-thumb: #6fc3df;
  --scrollbar-thumb-hover: #ffff00;
  --scrollbar-thumb-active: #ffff00;
}

.code-editor-view *,
.code-editor-view *::before,
.code-editor-view *::after { box-sizing: border-box; }
.code-editor-view,
.code-editor-view * { scrollbar-width: thin; scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track); }
.code-editor-view::-webkit-scrollbar,
.code-editor-view *::-webkit-scrollbar { width: var(--scrollbar-size); height: var(--scrollbar-size); }
.code-editor-view::-webkit-scrollbar-track,
.code-editor-view *::-webkit-scrollbar-track { background: var(--scrollbar-track); }
.code-editor-view::-webkit-scrollbar-thumb,
.code-editor-view *::-webkit-scrollbar-thumb { min-height: 36px; border: 2px solid var(--scrollbar-track); border-radius: var(--scrollbar-radius); background-color: var(--scrollbar-thumb); }
.code-editor-view::-webkit-scrollbar-thumb:hover,
.code-editor-view *::-webkit-scrollbar-thumb:hover { background-color: var(--scrollbar-thumb-hover); }
.code-editor-view::-webkit-scrollbar-thumb:active,
.code-editor-view *::-webkit-scrollbar-thumb:active { background-color: var(--scrollbar-thumb-active); }
.code-editor-view::-webkit-scrollbar-corner,
.code-editor-view *::-webkit-scrollbar-corner { background: transparent; }
.code-editor-view button,
.code-editor-view input,
.code-editor-view select,
.code-editor-view textarea { font: inherit; }
.code-editor-view button { border: 1px solid var(--border); border-radius: 4px; background: var(--button); color: var(--text); cursor: pointer; }
.code-editor-view button:hover:not(:disabled) { background: var(--button-hover); border-color: var(--button-hover-border); }
.code-editor-view button:disabled { cursor: not-allowed; opacity: 0.45; }
.code-editor-view.app-shell.side-panel-hidden { grid-template-columns: 48px 0 minmax(0, 1fr); }
.code-editor-view.app-shell.resizing { cursor: col-resize; user-select: none; }
.code-editor-view .activity-bar { display: flex; flex-direction: column; align-items: stretch; gap: 6px; padding: 8px 0; background: var(--activity); border-right: 1px solid var(--border); }
.code-editor-view .activity-button { width: 48px; height: 48px; border: 0; border-left: 2px solid transparent; border-radius: 0; background: transparent; color: var(--muted); }
.code-editor-view .activity-button.active { border-left-color: var(--accent-strong); color: var(--text); }
.code-editor-view .activity-button span { font-size: 22px; }
.code-editor-view .side-panel { position: relative; min-width: 0; overflow: hidden; background: var(--panel); border-right: 1px solid var(--border); }
.code-editor-view.side-panel-hidden .side-panel { border-right: 0; }
.code-editor-view .side-panel-resizer { position: absolute; top: 0; right: 0; z-index: 5; width: 6px; height: 100%; background: transparent; cursor: col-resize; }
.code-editor-view .side-panel-resizer:hover,
.code-editor-view.app-shell.resizing .side-panel-resizer { background: var(--accent); opacity: 0.35; }
.code-editor-view.side-panel-hidden .side-panel-resizer { display: none; }
.code-editor-view .panel-view { display: flex; height: 100%; min-height: 0; flex-direction: column; }
.code-editor-view .panel-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 16px 14px 10px; }
.code-editor-view .panel-title { min-width: 0; }
.code-editor-view .panel-header h1 { margin: 0; font-size: 14px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
.code-editor-view .eyebrow { margin: 0 0 3px; color: var(--muted); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }
.code-editor-view .panel-workspace-name { display: block; overflow: hidden; margin-top: 4px; color: var(--muted); font-size: 12px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.code-editor-view .icon-button { width: 28px; height: 28px; padding: 0; }
.code-editor-view .small-button { padding: 5px 8px; font-size: 12px; }
.code-editor-view .ai-panel-view { position: relative; }
.code-editor-view .ai-panel-header { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; }
.code-editor-view .ai-panel-header > div:first-child { min-width: 0; }
.code-editor-view .ai-header-actions { display: flex; align-items: center; gap: 6px; min-width: 0; }
.code-editor-view .ai-header-actions button { flex: 0 0 auto; }
.code-editor-view .ai-context-length { display: block; margin-top: 4px; color: var(--muted); font-size: 11px; line-height: 1.35; overflow-wrap: anywhere; }
.code-editor-view .panel-actions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; padding: 0 12px 12px; }
.code-editor-view .panel-actions button,
.code-editor-view .empty-state button { padding: 7px 10px; }
.code-editor-view .panel-actions button { min-width: 0; padding-inline: 3px; overflow: hidden; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.code-editor-view .panel-actions button.danger { color: #ffb3b3; }
.code-editor-view .workspace-card { display: grid; gap: 3px; margin: 0 12px 8px; padding: 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--panel-soft); }
.code-editor-view .workspace-name { overflow: hidden; font-size: 13px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.code-editor-view .workspace-card small { color: var(--muted); }
.code-editor-view .file-tree { flex: 1; min-height: 0; overflow: auto; padding: 4px 0 16px; }
.code-editor-view .tree-list { margin: 0; padding: 0; list-style: none; }
.code-editor-view .tree-row { display: flex; align-items: center; gap: 6px; width: 100%; min-height: 24px; padding: 3px 8px; border: 0; border-radius: 0; background: transparent; color: var(--text); text-align: left; }
.code-editor-view .tree-row:hover,
.code-editor-view .tree-row.active { background: var(--button-hover); }
.code-editor-view .tree-row .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.code-editor-view .tree-dirty { margin-left: auto; color: var(--accent-strong); font-size: 16px; line-height: 1; }
.code-editor-view .tree-row .chevron { width: 12px; color: var(--muted); text-align: center; }
.code-editor-view .tree-row .icon { width: 16px; color: var(--file-icon); font-size: 16px; text-align: center; }
.code-editor-view .tree-row .folder-icon { color: var(--folder-icon); }
.code-editor-view .file-js,
.code-editor-view .file-ts { color: #f7df1e !important; }
.code-editor-view .file-html { color: #e37933 !important; }
.code-editor-view .file-css,
.code-editor-view .file-scss { color: #42a5f5 !important; }
.code-editor-view .file-json,
.code-editor-view .file-yaml { color: #f1c40f !important; }
.code-editor-view .file-md { color: #8ab4f8 !important; }
.code-editor-view .file-py { color: #4b8bbe !important; }
.code-editor-view .file-go { color: #00add8 !important; }
.code-editor-view .file-rust { color: #ce6f2d !important; }
.code-editor-view .file-db { color: #b48ead !important; }
.code-editor-view .file-terminal { color: #89d185 !important; }
.code-editor-view .context-menu { position: fixed; z-index: 20; display: grid; min-width: 190px; padding: 4px; border: 1px solid var(--border); border-radius: 6px; background: var(--panel); box-shadow: 0 12px 32px var(--shadow); }
.code-editor-view .context-menu button { width: 100%; padding: 7px 10px; border: 0; border-radius: 4px; background: transparent; color: var(--text); text-align: left; }
.code-editor-view .context-menu button:hover:not(:disabled) { background: var(--context-hover); border-color: transparent; }
.code-editor-view .context-menu button.danger { color: #ffb3b3; }
.code-editor-view .context-separator { height: 1px; margin: 4px 6px; background: var(--border); }
.code-editor-view .settings-list { display: grid; gap: 12px; padding: 0 14px 18px; overflow: auto; }
.code-editor-view .search-form { display: grid; gap: 6px; padding: 0 12px 12px; }
.code-editor-view .search-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 6px; }
.code-editor-view .replace-row { grid-template-columns: minmax(0, 1fr) auto; }
.code-editor-view .search-form input { min-width: 0; border: 1px solid var(--border); border-radius: 4px; background: var(--input); color: var(--text); padding: 7px 8px; }
.code-editor-view .search-form input:focus { border-color: var(--accent-strong); outline: none; }
.code-editor-view .search-form button { padding: 7px 10px; }
.code-editor-view .search-form .search-option { min-width: 34px; padding: 7px 8px; color: var(--muted); font-weight: 700; }
.code-editor-view .search-form .search-option.active { border-color: var(--accent-strong); background: var(--context-hover); color: var(--text); }
.code-editor-view .search-results { min-height: 0; overflow: auto; padding: 0 0 16px; }
.code-editor-view .search-result-file { display: grid; gap: 1px; }
.code-editor-view .search-result-file-header { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 7px; width: 100%; min-height: 30px; padding: 5px 12px; border: 0; border-radius: 0; background: transparent; color: var(--text); text-align: left; }
.code-editor-view .search-result-file-header:hover { background: var(--button-hover); }
.code-editor-view .search-result-file-header span:not(.codicon) { overflow: hidden; font-size: 12px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.code-editor-view .search-result-file-header small { color: var(--muted); font-size: 11px; }
.code-editor-view .search-result-match { display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 6px; width: 100%; min-height: 26px; padding: 4px 12px 4px 34px; border: 0; border-radius: 0; background: transparent; color: var(--text); text-align: left; }
.code-editor-view .search-result-match:hover { background: var(--button-hover); }
.code-editor-view .search-result-match small { color: var(--muted); font-size: 11px; text-align: right; }
.code-editor-view .search-result-line { overflow: hidden; font-family: Consolas, 'Courier New', monospace; font-size: 12px; text-overflow: ellipsis; white-space: pre; }
.code-editor-view .search-result-line mark { border-radius: 2px; background: #f6d365; color: #1f1f1f; }
.code-editor-view .change-count { min-width: 24px; padding: 2px 7px; border: 1px solid var(--border); border-radius: 999px; color: var(--muted); text-align: center; }
.code-editor-view .changes-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 0 12px 10px; color: var(--muted); font-size: 12px; }
.code-editor-view .changes-toolbar button { padding: 5px 8px; font-size: 12px; }
.code-editor-view .changes-toolbar > span { margin-left: auto; }
.code-editor-view .change-select-all { display: flex; align-items: center; min-width: 0; gap: 6px; color: var(--text); }
.code-editor-view .change-select-all input,
.code-editor-view .change-row input[type="checkbox"] { flex: 0 0 auto; width: 14px; height: 14px; accent-color: var(--accent); }
.code-editor-view .changes-list { display: grid; align-content: start; gap: 2px; min-height: 0; overflow: auto; padding: 0 0 16px; }
.code-editor-view .change-row { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 38px; padding: 6px 12px; border: 0; border-radius: 0; background: transparent; color: var(--text); cursor: pointer; text-align: left; }
.code-editor-view .change-row:hover,
.code-editor-view .change-row.active { background: var(--button-hover); }
.code-editor-view .change-row:focus-visible { outline: 1px solid var(--accent-strong); outline-offset: -1px; }
.code-editor-view .change-row .codicon { color: var(--accent-strong); }
.code-editor-view .change-main { display: grid; min-width: 0; gap: 2px; }
.code-editor-view .change-main strong,
.code-editor-view .change-main small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.code-editor-view .change-main strong { font-size: 13px; font-weight: 600; }
.code-editor-view .change-main small { color: var(--muted); font-size: 11px; }
.code-editor-view .ssh-list { display: grid; flex: 1 1 auto; align-content: start; gap: 8px; min-height: 0; overflow: auto; padding: 0 12px 16px; }
.code-editor-view .ssh-disabled-card strong { font-size: 13px; }
.code-editor-view .ssh-card { display: grid; gap: 8px; padding: 10px; border: 1px solid var(--border); border-radius: 7px; background: var(--panel-soft); }
.code-editor-view .ssh-card.active { border-color: var(--accent-strong); }
.code-editor-view .ssh-card-main { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 8px; }
.code-editor-view .ssh-card-main > .codicon { color: var(--accent-strong); font-size: 17px; }
.code-editor-view .ssh-card-main div { display: grid; min-width: 0; gap: 2px; }
.code-editor-view .ssh-card-main strong,
.code-editor-view .ssh-card-main small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.code-editor-view .ssh-card-main strong { font-size: 13px; }
.code-editor-view .ssh-card-main small,
.code-editor-view .ssh-card-meta { color: var(--muted); font-size: 11px; }
.code-editor-view .ssh-card-meta { display: flex; flex-wrap: wrap; gap: 8px; }
.code-editor-view .ssh-card-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.code-editor-view .ssh-card-actions button { padding: 5px 7px; font-size: 12px; }
.code-editor-view .ssh-card-actions .danger { color: #ffb3b3; }
.code-editor-view .sftp-task-panel { display: grid; flex: 0 0 auto; gap: 6px; padding: 0 12px 12px; }
.code-editor-view .sftp-task-toggle { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 7px 9px; background: var(--panel-soft); color: var(--text); font-size: 12px; }
.code-editor-view .sftp-task-list { display: grid; max-height: min(360px, 40vh); overflow: auto; gap: 8px; padding-right: 2px; }
.code-editor-view .sftp-task-card { display: grid; gap: 6px; padding: 9px; border: 1px solid var(--border); border-radius: 7px; background: var(--panel-soft); }
.code-editor-view .sftp-task-main { display: grid; min-width: 0; gap: 2px; }
.code-editor-view .sftp-task-main strong { font-size: 12px; }
.code-editor-view .sftp-task-main small { overflow: hidden; color: var(--muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.code-editor-view .sftp-task-meta { display: flex; justify-content: space-between; gap: 8px; color: var(--muted); font-size: 11px; }
.code-editor-view .sftp-task-card progress { width: 100%; height: 8px; accent-color: var(--accent); }
.code-editor-view .sftp-task-error { margin: 0; color: #ffb3b3; font-size: 11px; line-height: 1.35; overflow-wrap: anywhere; }
.code-editor-view .sftp-task-completed { border-color: color-mix(in srgb, var(--accent-strong) 45%, var(--border)); }
.code-editor-view .ai-session-toolbar { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 6px; margin: 0 12px 10px; padding: 9px 8px 9px 10px; border: 1px solid var(--border); border-radius: 7px; background: var(--panel-soft); }
.code-editor-view .ai-session-identity { display: grid; min-width: 0; gap: 4px; }
.code-editor-view .ai-session-title-button { width: 100%; min-width: 0; overflow: hidden; padding: 0; border: 0; background: transparent; color: var(--text); font-size: 13px; font-weight: 700; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
.code-editor-view .ai-session-title-button:hover:not(:disabled) { border-color: transparent; background: transparent; color: var(--accent-strong); }
.code-editor-view .ai-session-title-input { width: 100%; min-width: 0; border: 1px solid var(--accent-strong); border-radius: 4px; outline: none; background: var(--input); color: var(--text); padding: 4px 6px; font-size: 13px; font-weight: 700; }
.code-editor-view .ai-session-meta { display: flex; align-items: center; min-width: 0; gap: 7px; overflow: hidden; color: var(--muted); font-size: 10px; white-space: nowrap; }
.code-editor-view .ai-session-meta > span { overflow: hidden; text-overflow: ellipsis; }
.code-editor-view .ai-session-save-status { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 4px; }
.code-editor-view .ai-session-status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); }
.code-editor-view .ai-session-save-status.saved .ai-session-status-dot { background: var(--accent-strong); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-strong) 20%, transparent); }
.code-editor-view .ai-session-toolbar > .icon-button { border-color: transparent; background: transparent; color: var(--muted); }
.code-editor-view .ai-session-toolbar > .icon-button:hover:not(:disabled),
.code-editor-view .ai-session-toolbar > .icon-button.active { border-color: var(--border); background: var(--button-hover); color: var(--text); }
.code-editor-view .ai-session-menu { position: absolute; top: calc(100% + 5px); right: 0; z-index: 12; display: grid; width: min(260px, calc(100vw - 76px)); padding: 5px; border: 1px solid var(--border); border-radius: 7px; background: var(--panel); box-shadow: 0 12px 32px var(--shadow); }
.code-editor-view .ai-session-menu > button { width: 100%; padding: 7px 9px; border: 0; background: transparent; text-align: left; }
.code-editor-view .ai-session-menu > button:hover:not(:disabled) { border-color: transparent; background: var(--context-hover); }
.code-editor-view .ai-session-menu > button.danger { color: #ffb3b3; }
.code-editor-view .ai-session-menu-save { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 8px; padding: 7px 9px; cursor: pointer; }
.code-editor-view .ai-session-menu-save input { margin: 0; accent-color: var(--accent); }
.code-editor-view .ai-session-menu-save span { display: grid; min-width: 0; gap: 2px; }
.code-editor-view .ai-session-menu-save strong { font-size: 12px; }
.code-editor-view .ai-session-menu-save small { color: var(--muted); font-size: 10px; line-height: 1.35; }
.code-editor-view .ai-history-drawer { position: absolute; z-index: 15; inset: 0; display: grid; grid-template-rows: auto auto minmax(0, 1fr); min-width: 0; background: var(--panel); box-shadow: 8px 0 24px var(--shadow); }
.code-editor-view .ai-history-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 16px 14px 10px; border-bottom: 1px solid var(--border); }
.code-editor-view .ai-history-header h2 { margin: 0; font-size: 14px; letter-spacing: 0.04em; text-transform: uppercase; }
.code-editor-view .ai-history-search { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 7px; margin: 10px 12px; padding: 0 8px; border: 1px solid var(--border); border-radius: 5px; background: var(--input); color: var(--muted); }
.code-editor-view .ai-history-search:focus-within { border-color: var(--accent-strong); }
.code-editor-view .ai-history-search input { width: 100%; min-width: 0; padding: 7px 0; border: 0; outline: none; background: transparent; color: var(--text); }
.code-editor-view .ai-history-list { min-height: 0; overflow: auto; padding: 0 0 16px; }
.code-editor-view .ai-history-group { display: grid; gap: 2px; }
.code-editor-view .ai-history-group h3 { margin: 10px 12px 4px; color: var(--muted); font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
.code-editor-view .ai-history-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; min-width: 0; }
.code-editor-view .ai-history-item:hover,
.code-editor-view .ai-history-item.active { background: var(--button-hover); }
.code-editor-view .ai-history-item-main { display: grid; min-width: 0; gap: 3px; padding: 8px 8px 8px 14px; border: 0; background: transparent; color: var(--text); text-align: left; }
.code-editor-view .ai-history-item-main:hover:not(:disabled) { border-color: transparent; background: transparent; }
.code-editor-view .ai-history-item-main strong,
.code-editor-view .ai-history-item-main small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.code-editor-view .ai-history-item-main strong { font-size: 12px; }
.code-editor-view .ai-history-item-main small { color: var(--muted); font-size: 10px; }
.code-editor-view .ai-history-item-main small .codicon { margin-right: 3px; font-size: 10px; }
.code-editor-view .ai-history-delete { width: 28px; height: 28px; margin-right: 8px; padding: 0; border-color: transparent; background: transparent; color: var(--muted); }
.code-editor-view .ai-history-delete:hover:not(:disabled) { border-color: var(--border); background: var(--panel-soft); color: #ffb3b3; }
.code-editor-view .ai-chat { display: grid; grid-template-rows: minmax(0, 1fr) auto; min-height: 0; flex: 1; }
.code-editor-view .ai-chat-messages { display: grid; align-content: start; gap: 10px; min-height: 0; overflow: hidden auto; overflow-anchor: none; padding: 0 12px 12px; }
.code-editor-view .ai-message { display: grid; min-width: 0; gap: 5px; padding: 9px 10px; border: 1px solid var(--border); border-radius: 7px; background: var(--panel-soft); }
.code-editor-view .ai-message strong { color: var(--accent-strong); font-size: 12px; }
.code-editor-view .ai-message-user strong { color: var(--text); }
.code-editor-view .ai-message-tool { opacity: 0.88; }
.code-editor-view .ai-tool-toggle { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; padding: 0; border: 0; background: transparent; color: var(--accent-strong); text-align: left; font-size: 12px; font-weight: 700; }
.code-editor-view .ai-tool-toggle:hover:not(:disabled) { background: transparent; border-color: transparent; }
.code-editor-view .ai-tool-details { display: grid; min-width: 0; max-width: 100%; gap: 8px; }
.code-editor-view .ai-tool-details > div { min-width: 0; max-width: 100%; }
.code-editor-view .ai-tool-details strong { display: block; margin-bottom: 4px; }
.code-editor-view .ai-tool-details pre { max-width: 100%; max-height: 240px; margin: 0; overflow-x: hidden; overflow-y: auto; overflow-wrap: anywhere; padding: 8px; border: 1px solid var(--border); border-radius: 5px; background: var(--editor); color: var(--text); font-family: Consolas, 'Courier New', monospace; font-size: 12px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
.code-editor-view .ai-image-result { display: grid; width: 100%; min-width: 0; gap: 6px; padding: 6px; border-color: var(--border); background: var(--editor); color: var(--muted); font-size: 10px; text-align: left; }
.code-editor-view .ai-image-result:hover { border-color: var(--accent-strong); background: var(--editor); color: var(--text); }
.code-editor-view .ai-image-result img { width: 100%; max-height: 260px; border-radius: 4px; object-fit: contain; background: var(--panel); }
.code-editor-view .ai-image-result span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.code-editor-view .ai-message-content { min-width: 0; max-width: 100%; overflow-wrap: anywhere; color: var(--text); font-size: 12px; word-break: break-word; }
.code-editor-view .ai-message-plain { white-space: pre-wrap; }
.code-editor-view .ai-message-content * { max-width: 100%; }
.code-editor-view .ai-message-content pre { overflow-x: auto; white-space: pre-wrap; }
.code-editor-view .ai-message-content code { white-space: break-spaces; }
.code-editor-view .ai-message-content table { display: block; overflow-x: auto; }
.code-editor-view .ai-chat-form { display: grid; gap: 8px; padding: 10px 12px 12px; border-top: 1px solid var(--border); background: var(--panel); }
.code-editor-view .ai-chat-form textarea { width: 100%; resize: vertical; min-height: 78px; max-height: 180px; border: 1px solid var(--border); border-radius: 5px; background: var(--input); color: var(--text); padding: 8px; line-height: 1.4; }
.code-editor-view .ai-chat-form button { padding: 7px 10px; }
.code-editor-view .ai-attachment-input { display: none; }
.code-editor-view .ai-attachment-list { display: flex; flex-wrap: wrap; gap: 6px; }
.code-editor-view .ai-attachment-chip { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: center; max-width: 100%; gap: 5px; padding: 4px 5px 4px 7px; border: 1px solid var(--border); border-radius: 5px; background: var(--panel-soft); color: var(--text); font-size: 11px; }
.code-editor-view .ai-attachment-chip > span:not(.codicon) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.code-editor-view .ai-attachment-chip > .codicon { color: var(--accent-strong); }
.code-editor-view .ai-attachment-chip small { color: var(--muted); white-space: nowrap; }
.code-editor-view .ai-chat-form .ai-attachment-chip button { display: grid; width: 20px; height: 20px; place-items: center; padding: 0; border-color: transparent; background: transparent; color: var(--muted); }
.code-editor-view .ai-chat-form .ai-attachment-chip button:hover:not(:disabled) { border-color: var(--border); background: var(--button-hover); color: var(--text); }
.code-editor-view .ai-chat-submit-row { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 8px; }
.code-editor-view .ai-chat-submit-row .ai-attach-button { display: grid; width: 36px; height: 36px; place-items: center; padding: 0; }
.code-editor-view .ai-chat-options { display: grid; grid-template-columns: minmax(0, 1fr) minmax(90px, 0.8fr); gap: 8px; }
.code-editor-view .ai-chat-options label { display: grid; min-width: 0; gap: 5px; color: var(--muted); font-size: 12px; }
.code-editor-view .ai-chat-options select { width: 100%; min-width: 0; border: 1px solid var(--border); border-radius: 4px; background: var(--input); color: var(--text); padding: 6px 7px; }
.code-editor-view .setting-row { display: grid; gap: 6px; color: var(--text); font-size: 13px; }
.code-editor-view .setting-row input,
.code-editor-view .setting-row select,
.code-editor-view .setting-row textarea { width: 100%; border: 1px solid var(--border); border-radius: 4px; background: var(--input); color: var(--text); padding: 7px 8px; }
.code-editor-view .setting-title-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.code-editor-view .setting-title-row button { padding: 4px 8px; font-size: 12px; }
.code-editor-view .setting-action-button { padding: 7px 10px; }
.code-editor-view .setting-inline-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
.code-editor-view .setting-inline-row button { padding: 7px 10px; }
.code-editor-view .keybinding-card { padding: 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--panel-soft); }
.code-editor-view .shortcut-row { display: grid; grid-template-columns: 1fr minmax(86px, 110px); align-items: center; gap: 8px; }
.code-editor-view .setting-hint { color: var(--muted); line-height: 1.45; }
.code-editor-view .checkbox-row { display: flex; align-items: center; gap: 8px; }
.code-editor-view .checkbox-row input { width: auto; }
.code-editor-view .editor-shell { display: grid; grid-template-rows: 40px 46px minmax(0, 1fr) 26px; min-width: 0; min-height: 0; background: var(--editor); }
.code-editor-view .command-bar { display: flex; align-items: center; justify-content: center; min-width: 0; gap: 8px; padding: 5px 12px; border-bottom: 1px solid var(--border); background: var(--panel); }
.code-editor-view .command-center { display: grid; grid-template-columns: auto minmax(120px, 420px) auto; align-items: center; width: min(520px, 100%); height: 29px; padding: 0; border: 1px solid var(--border); border-radius: 6px; background: var(--input); color: var(--muted); text-align: left; box-shadow: inset 0 1px 0 rgb(255 255 255 / 4%); }
.code-editor-view .command-center:hover,
.code-editor-view .command-center:focus-visible { border-color: var(--accent-strong); background: var(--input); outline: none; box-shadow: 0 0 0 1px var(--accent-strong); }
.code-editor-view .command-center > .codicon { padding: 0 8px; font-size: 14px; }
.code-editor-view .command-center-label { min-width: 0; overflow: hidden; color: var(--muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.code-editor-view .command-center-shortcut { margin-right: 6px; padding: 1px 5px; border: 1px solid var(--border); border-radius: 4px; color: var(--muted); font-size: 10px; line-height: 16px; }
.code-editor-view .command-icon-button { display: inline-grid; width: 29px; height: 29px; place-items: center; padding: 0; border-color: var(--border); background: var(--input); color: var(--muted); }
.code-editor-view .command-icon-button:hover:not(:disabled),
.code-editor-view .command-icon-button:focus-visible { border-color: var(--accent-strong); background: var(--input); color: var(--text); outline: none; }
.code-editor-view .command-icon-button.active { border-color: var(--accent-strong); background: var(--context-hover); color: var(--text); }
.code-editor-view .tabs { display: flex; align-items: flex-start; min-width: 0; --scrollbar-size: 8px; overflow-x: auto; overflow-y: hidden; background: var(--panel); border-bottom: 1px solid var(--border); }
.code-editor-view .tab { display: flex; align-items: center; gap: 8px; min-width: 120px; max-width: 240px; height: 35px; padding: 0 8px 0 12px; border: 0; border-right: 1px solid var(--border); border-radius: 0; background: var(--tab); color: var(--muted); }
.code-editor-view .tab.active { background: var(--tab-active); color: var(--text); }
.code-editor-view .tab-name { overflow: hidden; flex: 1; text-overflow: ellipsis; white-space: nowrap; }
.code-editor-view .dirty-dot { color: #ffffff; font-size: 16px; line-height: 1; }
.code-editor-view .tab-close { display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 3px; }
.code-editor-view .tab-close:hover { background: var(--button-hover); }
.code-editor-view .editor-stage { position: relative; min-width: 0; min-height: 0; overflow: hidden; }
.code-editor-view .monaco-host { position: absolute; inset: 0; opacity: 0; pointer-events: none; }
.code-editor-view .monaco-host.visible { opacity: 1; pointer-events: auto; }
.code-editor-view .ssh-terminal { position: absolute; inset: 0; display: grid; grid-template-rows: 34px minmax(0, 1fr); min-width: 0; min-height: 0; overflow: hidden; background: var(--editor); }
.code-editor-view .ssh-terminal-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 0 12px; border-bottom: 1px solid var(--border); background: var(--panel); color: var(--text); font-size: 12px; font-weight: 600; }
.code-editor-view .ssh-terminal-header small { color: var(--muted); font-weight: 500; }
.code-editor-view .ssh-terminal-host { min-width: 0; min-height: 0; overflow: hidden; }
.code-editor-view .ssh-terminal-host .terminal { width: 100%; height: 100%; }
.code-editor-view .ssh-terminal-fallback { min-width: 0; min-height: 0; margin: 0; overflow: auto; padding: 10px 12px; background: var(--editor); color: var(--text); font-family: Consolas, 'Courier New', monospace; font-size: 13px; line-height: 1.45; white-space: pre-wrap; }
.code-editor-view .editor-stage.preview-open .monaco-host.visible,
.code-editor-view .editor-stage.preview-open .unsupported-preview { right: var(--preview-pane-size); }
.code-editor-view .preview-pane { position: absolute; inset: 0 0 0 auto; z-index: 4; display: grid; grid-template-rows: 34px minmax(0, 1fr); width: var(--preview-pane-size); border-left: 1px solid var(--border); background: var(--editor); color: var(--text); box-shadow: -12px 0 24px rgb(0 0 0 / 14%); }
.code-editor-view .preview-pane-resizer { position: absolute; top: 0; left: -3px; z-index: 6; width: 6px; height: 100%; background: transparent; cursor: col-resize; }
.code-editor-view .preview-pane-resizer:hover,
.code-editor-view.preview-resizing .preview-pane-resizer { background: var(--accent); opacity: 0.35; }
.code-editor-view.preview-resizing .preview-frame { pointer-events: none; }
.code-editor-view .preview-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 8px 0 12px; border-bottom: 1px solid var(--border); background: var(--panel); color: var(--muted); font-size: 12px; font-weight: 600; }
.code-editor-view .preview-header-actions { display: flex; align-items: center; gap: 4px; }
.code-editor-view .preview-external-link { display: inline-grid; place-items: center; border: 1px solid var(--border); border-radius: 4px; background: var(--button); color: var(--text); text-decoration: none; }
.code-editor-view .preview-external-link:hover,
.code-editor-view .preview-external-link:focus-visible { border-color: var(--button-hover-border); background: var(--button-hover); outline: none; }
.code-editor-view .preview-content { min-height: 0; overflow: auto; padding: 18px; background: var(--editor); color: var(--text); }
.code-editor-view .markdown-preview { font-size: 14px; line-height: 1.55; }
.code-editor-view .preview-frame { width: 100%; height: 100%; border: 0; background: #ffffff; color-scheme: light; }
.code-editor-view .image-preview { position: absolute; inset: 0; display: grid; grid-template-rows: minmax(0, 1fr) auto; align-items: center; justify-items: center; gap: 18px; padding: 24px; overflow: auto; background: var(--editor); }
.code-editor-view .image-preview > img { max-width: 100%; max-height: 100%; object-fit: contain; box-shadow: 0 12px 32px var(--shadow); }
.code-editor-view .image-preview-meta { display: grid; justify-items: center; gap: 4px; max-width: min(680px, 100%); color: var(--muted); font-size: 12px; text-align: center; }
.code-editor-view .image-preview-meta strong { max-width: 100%; overflow: hidden; color: var(--text); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.code-editor-view .unsupported-preview { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 10px; padding: 28px; overflow: auto; background: var(--editor); color: var(--muted); text-align: center; }
.code-editor-view .unsupported-preview .codicon { color: var(--accent-strong); font-size: 42px; }
.code-editor-view .unsupported-preview h2 { margin: 0; color: var(--text); font-size: clamp(18px, 3vw, 28px); font-weight: 650; }
.code-editor-view .unsupported-preview p { max-width: 560px; margin: 0; line-height: 1.6; }
.code-editor-view .unsupported-preview small { max-width: min(680px, 100%); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.code-editor-view .empty-state { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 14px; padding: 28px; color: var(--muted); text-align: center; }
.code-editor-view .empty-state h2 { margin: 0; color: var(--text); font-size: clamp(22px, 4vw, 36px); font-weight: 650; }
.code-editor-view .empty-state p { max-width: 560px; margin: 0; line-height: 1.6; }
.code-editor-view .status-bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 0 8px 0 10px; background: var(--status); color: var(--status-text); font-size: 12px; }
.code-editor-view .status-left-group,
.code-editor-view .status-right-group { display: flex; align-items: center; min-width: 0; gap: 8px; }
.code-editor-view .status-left-group { flex: 1; }
.code-editor-view .status-right-group { justify-content: flex-end; }
.code-editor-view .status-bar span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.code-editor-view #status-left { min-width: 0; }
.code-editor-view #save-file { flex: 0 0 auto; height: 20px; padding: 0 7px; border-color: var(--status-control-border); background: var(--status-control-bg); color: var(--status-text); font-size: 11px; }
.code-editor-view #save-file:hover:not(:disabled) { background: var(--status-control-hover); }
.code-editor-view .status-right-group select { width: 132px; height: 21px; border: 1px solid var(--border); border-radius: 3px; background: var(--editor); color: var(--text); font-size: 12px; }
.code-editor-view .status-right-group select:hover:not(:disabled),
.code-editor-view .status-right-group select:focus { border-color: var(--accent-strong); background: var(--input); color: var(--text); outline: none; }
.code-editor-view .status-right-group select:disabled { opacity: 0.5; }
.code-editor-view .editor-dialog-backdrop { position: fixed; inset: 0; z-index: 40; display: grid; place-items: center; padding: 18px; background: rgb(0 0 0 / 46%); backdrop-filter: blur(2px); }
.code-editor-view .editor-dialog { display: grid; gap: 14px; width: min(560px, 100%); max-height: min(760px, calc(100vh - 36px)); overflow: auto; padding: 18px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel); color: var(--text); box-shadow: 0 20px 60px var(--shadow); }
.code-editor-view .editor-dialog-header { display: flex; align-items: center; gap: 10px; min-width: 0; }
.code-editor-view .editor-dialog-header .codicon { flex: 0 0 auto; color: var(--accent-strong); font-size: 18px; }
.code-editor-view .editor-dialog-header .codicon-warning,
.code-editor-view .editor-dialog-header .codicon-error { color: #ffb3b3; }
.code-editor-view .editor-dialog h2 { min-width: 0; margin: 0; overflow: hidden; font-size: 15px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.code-editor-view .editor-dialog-message { margin: 0; overflow-wrap: anywhere; color: var(--text); font-size: 13px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
.code-editor-view .editor-dialog-input-row { display: grid; gap: 6px; color: var(--muted); font-size: 12px; }
.code-editor-view .editor-dialog-input-row input,
.code-editor-view .editor-dialog-input-row select { width: 100%; border: 1px solid var(--border); border-radius: 5px; background: var(--input); color: var(--text); padding: 8px 9px; }
.code-editor-view .editor-dialog-input-row input:focus,
.code-editor-view .editor-dialog-input-row select:focus { border-color: var(--accent-strong); outline: none; box-shadow: 0 0 0 1px var(--accent-strong); }
.code-editor-view .editor-dialog-option { display: flex; align-items: flex-start; gap: 9px; padding: 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--panel-soft); cursor: pointer; }
.code-editor-view .editor-dialog-option.disabled { cursor: not-allowed; opacity: 0.62; }
.code-editor-view .editor-dialog-option > input { flex: 0 0 auto; width: auto; margin: 2px 0 0; accent-color: var(--accent-strong); }
.code-editor-view .editor-dialog-option-copy { display: grid; min-width: 0; gap: 3px; }
.code-editor-view .editor-dialog-option-copy strong { color: var(--text); font-size: 13px; font-weight: 600; }
.code-editor-view .editor-dialog-option-copy small { color: var(--muted); font-size: 11px; line-height: 1.45; }
.code-editor-view .ssh-dialog { width: min(620px, 100%); max-height: min(760px, calc(100vh - 36px)); overflow: auto; }
.code-editor-view .ssh-dialog-grid { display: grid; grid-template-columns: minmax(0, 1fr) 120px; gap: 10px; }
.code-editor-view .editor-dialog-actions { position: sticky; bottom: -18px; display: flex; justify-content: flex-end; gap: 8px; margin: 0 -18px -18px; padding: 12px 18px 18px; border-top: 1px solid var(--border); background: var(--panel); }
.code-editor-view .editor-dialog-actions button,
.code-editor-view .editor-dialog-actions a { min-width: 76px; padding: 7px 12px; text-align: center; text-decoration: none; }
.code-editor-view .editor-dialog-actions a { display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--border); border-radius: 4px; cursor: pointer; }
.code-editor-view .editor-dialog-actions .primary { border-color: var(--accent); background: var(--accent); color: #ffffff; }
.code-editor-view .editor-dialog-actions .primary:hover:not(:disabled) { border-color: var(--accent-strong); background: var(--accent-strong); }
.code-editor-view .editor-dialog-actions .primary.danger { border-color: #b8383d; background: #b8383d; }
.code-editor-view .editor-dialog-actions .primary.danger:hover:not(:disabled) { border-color: #d95055; background: #d95055; }

@media (max-width: 760px) {
  .code-editor-view.app-shell { grid-template-columns: 44px minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); height: 100dvh; }
  .code-editor-view.app-shell.side-panel-hidden { grid-template-columns: 44px minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); }
  .code-editor-view .activity-bar { grid-row: 1 / -1; }
  .code-editor-view .editor-shell { grid-column: 2; grid-row: 1; }
  .code-editor-view.app-shell:not(.side-panel-hidden) .editor-shell { display: none; }
  .code-editor-view .side-panel { z-index: 2; grid-column: 2; grid-row: 1; width: 100%; height: 100%; border-top: 0; border-right: 0; }
  .code-editor-view.side-panel-hidden .side-panel { display: none; }
  .code-editor-view .side-panel-resizer { display: none; }
  .code-editor-view .activity-button { width: 44px; height: 44px; }
  .code-editor-view .ai-panel-header { grid-template-columns: minmax(0, 1fr) max-content; align-items: start; gap: 12px; padding-right: 12px; }
  .code-editor-view .ai-header-actions { width: max-content; justify-content: flex-end; gap: 8px; }
  .code-editor-view .ai-header-actions .icon-button { width: 36px; height: 36px; }
  .code-editor-view .ai-context-length { font-size: 10px; }
  .code-editor-view .shortcut-row { grid-template-columns: 1fr; }
  .code-editor-view .command-center-shortcut { display: none; }
  .code-editor-view .status-right-group { display: none; }
  .code-editor-view .editor-stage.preview-open .monaco-host.visible,
  .code-editor-view .editor-stage.preview-open .unsupported-preview { right: 0; bottom: 45%; }
  .code-editor-view .preview-pane { inset: auto 0 0 0; width: auto; height: 45%; border-top: 1px solid var(--border); border-left: 0; box-shadow: 0 -12px 24px rgb(0 0 0 / 14%); }
  .code-editor-view .preview-pane-resizer { display: none; }
  .code-editor-view .editor-dialog-actions { flex-direction: column-reverse; }
  .code-editor-view .editor-dialog-actions button { width: 100%; }
}
</style>
