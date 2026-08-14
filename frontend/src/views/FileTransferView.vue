<template>
    <div class="min-h-screen flex flex-col bg-neutral">
        <common-toast ref="toastRef"></common-toast>
        <common-header :title="$route.meta.title" :icon="$route.meta.icon" link="/"></common-header>

        <main class="flex-grow">
            <div class="container mx-auto px-4 py-8">
                <section v-if="!sessionActive" class="mx-auto max-w-6xl">
                    <div class="rounded-xl bg-white p-6 shadow-lg sm:p-8 lg:p-10">
                        <div class="max-w-4xl">
                            <h2 class="text-2xl font-bold text-gray-800 sm:text-3xl">
                                {{ t('fileTransfer.hero.title') }}
                            </h2>
                            <p class="mt-3 text-sm leading-6 text-gray-600 sm:text-base">
                                {{ t('fileTransfer.hero.description') }}
                            </p>
                            <div class="mt-4 flex flex-wrap gap-2">
                                <span v-for="item in heroBadges" :key="item.label" class="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1.5 text-sm text-gray-600">
                                    <i :class="item.icon" class="text-primary"></i>
                                    {{ item.label }}
                                </span>
                            </div>
                        </div>

                        <div class="mt-8">
                            <label class="mb-2 block text-sm font-medium text-gray-700" for="device-name">
                                {{ t('fileTransfer.setup.deviceName') }}
                            </label>
                            <input id="device-name" v-model.trim="deviceName" class="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-gray-800 outline-none transition-colors placeholder:text-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/20" maxlength="128" :placeholder="t('fileTransfer.setup.deviceNamePlaceholder')">
                            <p class="mt-2 text-xs leading-5 text-gray-500">{{ t('fileTransfer.setup.deviceCodeHint', { code: deviceIdentityCode }) }}</p>
                        </div>

                        <div class="mt-8 border-t border-gray-200 pt-8">
                            <div class="grid gap-6 lg:grid-cols-2 lg:gap-8">
                                <div class="flex min-w-0 flex-col rounded-xl border border-blue-100 bg-blue-50/50 p-6">
                                    <div class="flex items-start gap-3">
                                        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                            <i class="fas fa-satellite-dish"></i>
                                        </div>
                                        <div class="min-w-0">
                                            <h3 class="text-lg font-semibold text-gray-800">{{ t('fileTransfer.setup.createTitle') }}</h3>
                                            <p class="mt-1 text-sm leading-6 text-gray-500">{{ t('fileTransfer.setup.createDescription') }}</p>
                                        </div>
                                    </div>
                                    <button type="button" class="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 font-medium text-white transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto lg:mt-auto lg:self-start" :disabled="actionBusy || configLoading" @click="createSession">
                                        <i :class="actionBusy && pendingAction === 'create' ? 'fas fa-spinner fa-spin' : 'fas fa-wand-magic-sparkles'"></i>
                                        {{ t('fileTransfer.setup.createAction') }}
                                    </button>
                                </div>

                                <div class="min-w-0 rounded-xl border border-gray-200 bg-gray-50 p-6">
                                    <div class="flex items-start gap-3">
                                        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-600">
                                            <i class="fas fa-link"></i>
                                        </div>
                                        <div class="min-w-0">
                                            <h3 class="text-lg font-semibold text-gray-800">{{ t('fileTransfer.setup.joinTitle') }}</h3>
                                            <p class="mt-1 text-sm leading-6 text-gray-500">{{ t('fileTransfer.setup.joinDescription') }}</p>
                                        </div>
                                    </div>
                                    <label class="mb-2 mt-4 block text-sm font-medium text-gray-700" for="join-code">
                                        {{ t('fileTransfer.setup.codeLabel') }}
                                    </label>
                                    <div class="flex flex-col gap-3 sm:flex-row">
                                        <input id="join-code" :value="formattedJoinCode" class="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-4 py-3 font-mono text-lg tracking-wider text-gray-800 outline-none transition-colors placeholder:text-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/20" inputmode="numeric" autocomplete="one-time-code" :placeholder="t('fileTransfer.setup.codePlaceholder')" @input="updateJoinCode" @keyup.enter="joinSession">
                                        <button type="button" class="inline-flex items-center justify-center gap-2 rounded-lg border border-primary bg-white px-5 py-3 font-medium text-primary transition-colors hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50" :disabled="actionBusy || configLoading" @click="joinSession">
                                            <i :class="actionBusy && pendingAction === 'join' ? 'fas fa-spinner fa-spin' : 'fas fa-arrow-right-to-bracket'"></i>
                                            {{ t('fileTransfer.setup.joinAction') }}
                                        </button>
                                    </div>
                                    <p class="mt-3 text-xs leading-5 text-gray-500">{{ t('fileTransfer.setup.codeHint') }}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <template v-else>
                    <section class="mx-auto max-w-6xl rounded-xl bg-white p-5 shadow-lg sm:p-6">
                        <div class="grid gap-5 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center">
                            <div class="min-w-0 rounded-lg bg-gray-50 p-4">
                                <p class="text-sm font-medium text-gray-500">{{ t('fileTransfer.session.codeLabel') }}</p>
                                <button type="button" class="mt-1 inline-flex max-w-full items-center gap-3 text-left text-gray-800 transition-colors hover:text-primary" @click="copySessionCode">
                                    <span class="font-mono text-2xl font-bold tracking-wider sm:text-3xl">{{ formattedSessionCode }}</span>
                                    <i class="far fa-copy shrink-0 text-sm text-primary"></i>
                                </button>
                            </div>

                            <div class="min-w-0">
                                <div class="flex flex-wrap items-center gap-2">
                                    <span class="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                                        {{ isOwner ? t('fileTransfer.session.owner') : t('fileTransfer.session.member') }}
                                    </span>
                                    <span class="max-w-full break-all rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600">{{ deviceName }}</span>
                                    <span class="rounded-full bg-gray-100 px-3 py-1 font-mono text-xs text-gray-500">#{{ deviceIdentityCode }}</span>
                                </div>
                                <div class="mt-3 flex min-w-0 items-start gap-2 text-sm text-gray-700">
                                    <span :class="participants.length ? 'bg-green-500' : 'bg-amber-500'" class="mt-1.5 h-2 w-2 shrink-0 rounded-full"></span>
                                    <span class="min-w-0 break-words">{{ t('fileTransfer.session.deviceCount', { current: roomDeviceCount, max: roomMaxParticipants }) }}</span>
                                </div>
                            </div>

                            <button type="button" class="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-600 transition-colors hover:bg-red-100 lg:w-auto" @click="handleSessionAction">
                                <i class="fas fa-power-off"></i>
                                {{ isOwner ? t('fileTransfer.session.closeAction') : t('fileTransfer.session.leaveAction') }}
                            </button>
                        </div>

                        <div class="mt-6 border-t border-gray-200 pt-5">
                            <h3 class="mb-3 text-sm font-semibold text-gray-700">{{ t('fileTransfer.connection.title') }}</h3>
                            <div class="grid gap-3 sm:grid-cols-3">
                                <article v-for="status in statusCards" :key="status.label" class="min-w-0 rounded-lg border border-gray-100 bg-gray-50 p-4">
                                    <div class="flex items-start gap-3">
                                        <span :class="status.dotClass" class="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"></span>
                                        <i :class="status.icon" class="mt-0.5 shrink-0 text-gray-400"></i>
                                        <div class="min-w-0">
                                            <p class="text-xs text-gray-500">{{ status.label }}</p>
                                            <p class="mt-1 break-words font-semibold text-gray-800">{{ status.value }}</p>
                                        </div>
                                    </div>
                                </article>
                            </div>
                        </div>
                    </section>

                    <section class="mx-auto mt-6 max-w-6xl rounded-xl bg-white p-5 shadow-lg sm:p-6">
                        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div class="min-w-0">
                                <h3 class="text-xl font-bold text-gray-800">
                                    <i class="fas fa-laptop-file mr-2 text-primary"></i>{{ t('fileTransfer.devices.title') }}
                                </h3>
                                <p class="mt-2 text-sm leading-6 text-gray-500">{{ t('fileTransfer.devices.description') }}</p>
                            </div>
                            <span class="shrink-0 rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
                                {{ t('fileTransfer.devices.count', { current: roomDeviceCount, max: roomMaxParticipants }) }}
                            </span>
                        </div>

                        <div v-if="participants.length" class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            <button v-for="participant in participants" :key="participant.participantId" type="button"
                                    class="min-w-0 rounded-xl border p-5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                                    :class="selectedTargetId === participant.participantId ? 'border-primary bg-blue-50 ring-2 ring-primary/10' : 'border-gray-200 bg-gray-50 hover:border-primary/40 hover:bg-white'"
                                    @click="selectTarget(participant.participantId)">
                                <div class="flex items-start justify-between gap-3">
                                    <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white text-lg text-primary shadow-sm">
                                        <i :class="participantDeviceIcon(participant)"></i>
                                    </span>
                                    <span v-if="selectedTargetId === participant.participantId" class="rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-white">
                                        {{ t('fileTransfer.devices.selected') }}
                                    </span>
                                </div>
                                <div class="mt-4 truncate font-semibold text-gray-800">{{ participant.displayName }}</div>
                                <div class="mt-1 truncate text-xs text-gray-500">{{ participantDeviceDetail(participant) }}</div>
                                <div class="mt-4 flex items-center gap-2 text-sm text-gray-600">
                                    <span :class="statusDotClass(participantChannelStatus(participant.participantId))" class="h-2.5 w-2.5 shrink-0 rounded-full"></span>
                                    <span>{{ connectionStatusText(participantChannelStatus(participant.participantId)) }}</span>
                                </div>
                            </button>
                        </div>

                        <div v-else class="mt-6 flex min-h-44 flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 px-6 py-8 text-center">
                            <i class="fas fa-users-viewfinder text-4xl text-gray-300"></i>
                            <strong class="mt-4 text-gray-700">{{ t('fileTransfer.devices.empty') }}</strong>
                            <span class="mt-2 text-sm text-gray-500">{{ t('fileTransfer.devices.emptyHint', { max: roomMaxParticipants }) }}</span>
                        </div>
                    </section>

                    <section class="mx-auto mt-6 grid max-w-6xl gap-6 lg:grid-cols-2">
                        <article class="min-w-0 rounded-xl bg-white p-5 shadow-lg sm:p-6">
                            <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                                <div class="min-w-0">
                                    <h3 class="text-xl font-bold text-gray-800">
                                        <i class="fas fa-paper-plane mr-2 text-primary"></i>{{ t('fileTransfer.files.title') }}
                                    </h3>
                                    <p class="mt-2 text-sm leading-6 text-gray-500">{{ t('fileTransfer.files.description') }}</p>
                                </div>
                                <div class="flex flex-wrap gap-2">
                                    <input ref="fileInput" class="hidden" type="file" multiple @change="handleFileSelection">
                                    <button type="button" class="inline-flex items-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50" :disabled="!selectedTarget || outgoingBusy" @click="openFilePicker">
                                        <i class="fas fa-plus"></i>
                                        {{ selectedFiles.length ? t('fileTransfer.files.addMore') : t('fileTransfer.files.choose') }}
                                    </button>
                                    <button v-if="selectedFiles.length" type="button" class="inline-flex items-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50" :disabled="outgoingBusy" @click="clearSelectedFiles">
                                        <i class="fas fa-trash-can"></i>
                                        {{ t('fileTransfer.files.clear') }}
                                    </button>
                                </div>
                            </div>

                            <div class="mt-5 rounded-lg border p-4" :class="selectedTarget ? 'border-blue-100 bg-blue-50' : 'border-amber-200 bg-amber-50'">
                                <div class="flex items-start gap-3">
                                    <i :class="selectedTarget ? 'fas fa-paper-plane text-primary' : 'fas fa-circle-exclamation text-amber-500'" class="mt-0.5 shrink-0"></i>
                                    <div class="min-w-0">
                                        <p class="text-xs font-medium" :class="selectedTarget ? 'text-blue-600' : 'text-amber-700'">{{ t('fileTransfer.files.targetLabel') }}</p>
                                        <p class="mt-1 truncate font-semibold" :class="selectedTarget ? 'text-blue-900' : 'text-amber-900'">
                                            {{ selectedTarget?.displayName || t('fileTransfer.files.targetRequired') }}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div v-if="selectedFiles.length" class="mt-6 space-y-3">
                                <div v-for="(file, index) in selectedFiles" :key="fileKey(file, index)" class="flex min-w-0 items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                                    <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                        <i class="fas fa-file"></i>
                                    </div>
                                    <div class="min-w-0 flex-1">
                                        <div class="truncate font-medium text-gray-800">{{ file.name }}</div>
                                        <div class="mt-1 text-xs text-gray-500">{{ formatFileSize(file.size) }}</div>
                                    </div>
                                    <button type="button" class="shrink-0 rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-200 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-50" :aria-label="t('fileTransfer.files.remove')" :disabled="outgoingBusy" @click="removeSelectedFile(index)">
                                        <i class="fas fa-xmark"></i>
                                    </button>
                                </div>
                            </div>

                            <div v-else class="mt-6 flex min-h-48 flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 px-6 py-8 text-center">
                                <i class="fas fa-file-circle-plus text-4xl text-gray-300"></i>
                                <strong class="mt-4 text-gray-700">{{ t('fileTransfer.files.empty') }}</strong>
                                <span class="mt-2 text-sm text-gray-500">{{ t('fileTransfer.files.emptyHint') }}</span>
                            </div>

                            <div v-if="selectedOutgoingTransfer" class="mt-4 rounded-lg border border-blue-100 bg-blue-50 p-4">
                                <div class="flex items-center justify-between gap-3 text-sm">
                                    <span class="font-semibold text-blue-800">{{ transferStatusText(selectedOutgoingTransfer.status) }}</span>
                                    <span class="font-mono text-blue-700">{{ transferPercent(selectedOutgoingTransfer) }}%</span>
                                </div>
                                <p class="mt-2 truncate text-xs text-blue-700">{{ t('fileTransfer.progress.target', { device: selectedOutgoingTransfer.participantName || t('common.unknown') }) }}</p>
                                <div class="mt-3 h-2 overflow-hidden rounded-full bg-blue-100">
                                    <div class="h-full rounded-full bg-primary transition-[width] duration-200" :style="{ width: `${transferPercent(selectedOutgoingTransfer)}%` }"></div>
                                </div>
                                <div class="mt-3 flex flex-wrap justify-between gap-2 text-xs text-blue-700">
                                    <span>{{ t('fileTransfer.progress.sent', { current: formatFileSize(selectedOutgoingTransfer.sentBytes), total: formatFileSize(selectedOutgoingTransfer.totalBytes) }) }}</span>
                                    <span>{{ t('fileTransfer.progress.fileCount', { completed: selectedOutgoingTransfer.completedFiles, total: selectedOutgoingTransfer.files.length }) }}</span>
                                </div>
                                <button v-if="isOutgoingTransferActive(selectedOutgoingTransfer)" type="button" class="mt-3 rounded-lg bg-white px-3 py-2 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100" @click="cancelOutgoingTransfer(selectedOutgoingTransfer.participantId)">
                                    {{ t('fileTransfer.files.cancel') }}
                                </button>
                            </div>

                            <div class="mt-6 flex flex-col gap-3 sm:flex-row">
                                <button type="button" class="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 font-medium text-white transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50" :disabled="!canSendFiles" @click="sendSelectedFiles">
                                    <i class="fas fa-paper-plane"></i>
                                    {{ selectedFiles.length ? t('fileTransfer.files.send', { count: selectedFiles.length }) : t('fileTransfer.files.choose') }}
                                </button>
                            </div>
                            <p v-if="selectedTargetChannelStatus !== 'connected'" class="mt-3 text-xs text-amber-700">
                                <i class="fas fa-clock mr-1"></i>
                                {{ selectedTarget ? t('fileTransfer.files.waitingConnection') : t('fileTransfer.files.targetRequired') }}
                            </p>
                        </article>

                        <article class="min-w-0 rounded-xl bg-white p-5 shadow-lg sm:p-6">
                            <div class="flex items-start justify-between gap-4">
                                <div class="min-w-0">
                                    <h3 class="text-xl font-bold text-gray-800">
                                        <i class="fas fa-inbox mr-2 text-primary"></i>{{ t('fileTransfer.received.title') }}
                                    </h3>
                                    <p v-if="selectedIncomingTransfer?.status === 'receiving'" class="mt-2 text-sm font-medium text-green-700">{{ t('fileTransfer.incoming.receiving') }}</p>
                                </div>
                                <span class="shrink-0 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">{{ selectedReceivedFiles.length }}</span>
                            </div>

                            <div v-if="selectedIncomingTransfer" class="mt-4 rounded-lg border border-green-100 bg-green-50 p-4">
                                <div class="flex items-center justify-between gap-3 text-sm">
                                    <span class="font-semibold text-green-800">{{ incomingStatusText(selectedIncomingTransfer.status) }}</span>
                                    <span class="font-mono text-green-700">{{ transferPercent(selectedIncomingTransfer) }}%</span>
                                </div>
                                <p class="mt-2 truncate text-xs text-green-700">{{ t('fileTransfer.progress.source', { device: selectedIncomingTransfer.participantName || t('common.unknown') }) }}</p>
                                <div class="mt-3 h-2 overflow-hidden rounded-full bg-green-100">
                                    <div class="h-full rounded-full bg-green-500 transition-[width] duration-200" :style="{ width: `${transferPercent(selectedIncomingTransfer)}%` }"></div>
                                </div>
                                <div class="mt-3 text-xs text-green-700">
                                    {{ t('fileTransfer.progress.received', { current: formatFileSize(selectedIncomingTransfer.receivedBytes), total: formatFileSize(selectedIncomingTransfer.totalBytes) }) }}
                                </div>
                            </div>

                            <div v-if="selectedReceivedFiles.length" class="mt-6 space-y-3">
                                <div v-for="file in selectedReceivedFiles" :key="file.id" class="min-w-0 rounded-lg border border-gray-200 bg-gray-50 p-4">
                                    <div class="flex min-w-0 items-center gap-3">
                                        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-green-100 text-green-600">
                                            <i class="fas fa-file-circle-check"></i>
                                        </div>
                                        <div class="min-w-0 flex-1">
                                            <div class="truncate font-medium text-gray-800">{{ file.name }}</div>
                                            <div class="mt-1 text-xs text-gray-500">{{ formatFileSize(file.size) }}</div>
                                        </div>
                                    </div>
                                    <span class="mt-3 inline-flex items-center gap-2 text-sm font-medium text-green-700">
                                        <i class="fas fa-hard-drive"></i>
                                        {{ file.savedToDisk ? t('fileTransfer.received.saved') : t('fileTransfer.received.downloaded') }}
                                    </span>
                                </div>
                            </div>

                            <div v-else class="mt-6 flex min-h-48 flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 px-6 py-8 text-center">
                                <i class="fas fa-inbox text-4xl text-gray-300"></i>
                                <span class="mt-4 text-sm text-gray-500">{{ t('fileTransfer.received.empty') }}</span>
                            </div>
                        </article>
                    </section>

                    <p class="mx-auto mt-5 max-w-6xl text-center text-xs leading-5 text-gray-500">
                        <i class="fas fa-triangle-exclamation mr-1 text-amber-500"></i>
                        {{ t('fileTransfer.messages.networkHint') }}
                    </p>
                </template>
            </div>
        </main>

        <common-modal :visible="incomingOfferVisible" :title="t('fileTransfer.incoming.title')" max-width="max-w-xl" :close-on-overlay-click="false" @close="rejectIncomingTransfer">
            <div class="space-y-5">
                <div class="flex items-start gap-3 rounded-lg bg-gray-50 p-4">
                    <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <i class="fas fa-file-import"></i>
                    </div>
                    <p class="min-w-0 break-words text-sm leading-6 text-gray-600">{{ incomingOfferDescription }}</p>
                </div>

                <div class="max-h-64 space-y-2 overflow-y-auto pr-1">
                    <div v-for="file in incomingOffer?.files || []" :key="file.id" class="flex min-w-0 items-center justify-between gap-4 rounded-lg border border-gray-200 bg-white px-4 py-3">
                        <span class="min-w-0 truncate text-sm font-medium text-gray-800">{{ file.name }}</span>
                        <span class="shrink-0 text-xs text-gray-500">{{ formatFileSize(file.size) }}</span>
                    </div>
                </div>

                <p class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
                    {{ t('fileTransfer.incoming.memoryWarning', { limit: formatFileSize(DEFAULT_MAX_BLOB_DOWNLOAD_BYTES) }) }}
                </p>

                <div class="grid gap-3 sm:grid-cols-2">
                    <button type="button" class="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 font-medium text-white transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50" :disabled="incomingActionBusy" @click="acceptIncomingInBrowser">
                        <i class="fas fa-download"></i>
                        {{ t('fileTransfer.incoming.acceptBrowser') }}
                    </button>
                    <button type="button" class="inline-flex items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-3 font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50" :disabled="!supportsDirectoryPicker || incomingActionBusy" @click="acceptIncomingToFolder">
                        <i class="fas fa-folder-open"></i>
                        {{ t('fileTransfer.incoming.acceptFolder') }}
                    </button>
                </div>
                <button type="button" class="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 font-medium text-red-600 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50" :disabled="incomingActionBusy" @click="rejectIncomingTransfer">
                    <i class="fas fa-xmark"></i>
                    {{ t('fileTransfer.incoming.reject') }}
                </button>
            </div>
        </common-modal>

        <common-footer copyright="© 2025 Gloduck"></common-footer>
    </div>
</template>

<script setup>
import {computed, onBeforeUnmount, onMounted, ref, shallowRef} from 'vue';
import {useI18n} from 'vue-i18n';
import {CommonComponents} from '@/shared/common-components.js';
import {CommonUtils} from '@/shared/common-utils.js';
import {formatFileSize} from '@/shared/file-utils.js';
import {createBlobSizeLimitError, DEFAULT_MAX_BLOB_DOWNLOAD_BYTES, prepareDownload} from '@/shared/file-downloader.js';
import {translateErrorMessage} from '@/i18n/index.js';
import {loadWebRtcConfig, WebRtcSignalingClient} from '@/shared/webrtc/signaling-client.js';
import {WebRtcPeerConnection} from '@/shared/webrtc/peer-connection.js';
import {WebRtcFileTransfer} from '@/shared/webrtc/file-transfer.js';

const CommonHeader = CommonComponents.Header;
const CommonFooter = CommonComponents.Footer;
const CommonToast = CommonComponents.Toast;
const CommonModal = CommonComponents.Modal;
const {t} = useI18n();
const BROWSER_DEFAULT_MAX_PARTICIPANTS = 10;
const DEVICE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECOVERABLE_PARTICIPANT_CODES = new Set([
    'WEBRTC_PARTICIPANT_TOKEN_INVALID',
    'WEBRTC_PARTICIPANT_NOT_IN_SESSION'
]);
const TERMINAL_SESSION_CODES = new Set([
    'WEBRTC_SESSION_NOT_FOUND',
    'WEBRTC_SESSION_EXPIRED',
    'WEBRTC_SESSION_CLOSED'
]);

const toastRef = ref(null);
const fileInput = ref(null);
const config = shallowRef(null);
const configLoading = ref(true);
const actionBusy = ref(false);
const pendingAction = ref('');
const sessionActive = ref(false);
const session = shallowRef(null);
const sessionCode = ref('');
const joinCode = ref('');
const isOwner = ref(false);
const participants = shallowRef([]);
const selectedTargetId = ref('');
const incomingOfferParticipantId = ref('');
const incomingActionBusy = ref(false);
const deviceIdentityCode = createDeviceIdentityCode();
const deviceName = ref(readDeviceName(deviceIdentityCode));
const signalingStatus = ref('loadingConfig');
const receivedFiles = shallowRef([]);

let signalingClient = null;
const peerContexts = new Map();
let sessionCredentials = null;
let recoveryPromise = null;
let recoveryScheduled = false;
let recoveryTimer = null;
let pageLeaveNotified = false;
let fileSelectionTargetId = '';

const heroBadges = computed(() => [
    {icon: 'fas fa-route', label: t('fileTransfer.hero.direct')},
    {icon: 'fas fa-shield-halved', label: t('fileTransfer.hero.encrypted')},
    {icon: 'fas fa-hourglass-half', label: t('fileTransfer.hero.temporary')}
]);
const formattedJoinCode = computed(() => formatConnectionCode(joinCode.value));
const formattedSessionCode = computed(() => formatConnectionCode(sessionCode.value));
const supportsDirectoryPicker = computed(() => Boolean(window.isSecureContext && window.showDirectoryPicker));
const configuredMaxParticipants = computed(() => minimumPositiveLimit(
    config.value?.maxParticipants,
    BROWSER_DEFAULT_MAX_PARTICIPANTS
));
const roomMaxParticipants = computed(() => minimumPositiveLimit(
    session.value?.maxParticipants,
    configuredMaxParticipants.value
));
const roomDeviceCount = computed(() => sessionActive.value ? participants.value.length + 1 : 0);
const connectedParticipantCount = computed(() => participants.value.filter((participant) => participantChannelStatus(participant.participantId) === 'connected').length);
const selectedTarget = computed(() => participants.value.find((participant) => participant.participantId === selectedTargetId.value) || null);
const selectedFiles = computed(() => getPeerSelectedFiles(selectedTargetId.value));
const selectedOutgoingTransfer = computed(() => getPeerTransfer(selectedTargetId.value, 'outgoingTransfer'));
const selectedIncomingTransfer = computed(() => {
    const transfer = getPeerTransfer(selectedTargetId.value, 'incomingTransfer');
    return transfer && ['offering', 'receiving'].includes(transfer.status) ? transfer : null;
});
const selectedReceivedFiles = computed(() => getPeerReceivedFiles(selectedTargetId.value));
const outgoingBusy = computed(() => isOutgoingTransferActive(selectedOutgoingTransfer.value));
const selectedTargetChannelStatus = computed(() => {
    const participantId = selectedTargetId.value;
    if (!participants.value.some((participant) => participant.participantId === participantId)) return 'idle';
    return peerContexts.get(participantId)?.channelStatus || 'connecting';
});
const canSendFiles = computed(() => selectedFiles.value.length > 0 && selectedTargetChannelStatus.value === 'connected' && !outgoingBusy.value);
const incomingOffer = computed(() => {
    const participantId = findIncomingOfferParticipantId(incomingOfferParticipantId.value);
    return participantId ? peerContexts.get(participantId)?.incomingTransfer || null : null;
});
const incomingOfferContext = computed(() => incomingOffer.value ? peerContexts.get(incomingOffer.value.sourceParticipantId) || null : null);
const incomingOfferVisible = computed(() => Boolean(incomingOffer.value));
const incomingOfferDescription = computed(() => t('fileTransfer.incoming.description', {
    device: incomingOffer.value?.sourceName || t('common.unknown'),
    count: incomingOffer.value?.files?.length || 0,
    size: formatFileSize(incomingOffer.value?.totalBytes || 0)
}));
const statusCards = computed(() => [
    statusCard('fileTransfer.connection.signaling', signalingStatus.value, 'fas fa-tower-broadcast'),
    valueStatusCard(
        'fileTransfer.connection.devices',
        `${roomDeviceCount.value} / ${roomMaxParticipants.value}`,
        participants.value.length ? 'connected' : 'waiting',
        'fas fa-users'
    ),
    valueStatusCard(
        'fileTransfer.connection.channels',
        `${connectedParticipantCount.value} / ${participants.value.length}`,
        participants.value.length === 0 ? 'idle' : (connectedParticipantCount.value === participants.value.length ? 'connected' : 'connecting'),
        'fas fa-arrow-right-arrow-left'
    )
]);

onMounted(async () => {
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleNetworkOnline);
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('pagehide', handlePageHide);
    try {
        config.value = await loadWebRtcConfig();
        signalingStatus.value = 'idle';
    } catch (error) {
        signalingStatus.value = 'error';
        showError(t('fileTransfer.messages.configFailed'), error);
    } finally {
        configLoading.value = false;
    }
});

onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('online', handleNetworkOnline);
    window.removeEventListener('pageshow', handlePageShow);
    window.removeEventListener('pagehide', handlePageHide);
    notifyLeave(true);
    teardownLocalSession({clearReceived: true});
});

async function createSession() {
    if (!validateDeviceName() || actionBusy.value) return;
    if (!config.value) {
        showToast(t('fileTransfer.messages.configFailed'), 'error');
        return;
    }

    actionBusy.value = true;
    pendingAction.value = 'create';
    signalingStatus.value = 'creating';
    const credentials = createParticipantCredentials();
    const client = createSignalingClient();
    try {
        let response = null;
        let code = '';
        for (let attempt = 0; attempt < 8; attempt += 1) {
            code = generateConnectionCode();
            try {
                response = await retryConnect(() => client.createSession(buildConnectRequest(code, credentials, true)));
                break;
            } catch (error) {
                if (error?.code !== 'WEBRTC_SESSION_KEY_CONFLICT') throw error;
            }
        }
        if (!response) throw new Error('WEBRTC_SESSION_KEY_CONFLICT');
        await activateSession(response, code, true, credentials);
    } catch (error) {
        signalingStatus.value = 'error';
        showError(t('fileTransfer.messages.createFailed'), error);
        teardownLocalSession();
    } finally {
        actionBusy.value = false;
        pendingAction.value = '';
    }
}

async function joinSession() {
    if (!validateDeviceName() || actionBusy.value) return;
    if (!/^\d{6}$/.test(joinCode.value)) {
        showToast(t('fileTransfer.messages.invalidCode'), 'warning');
        return;
    }
    if (!config.value) {
        showToast(t('fileTransfer.messages.configFailed'), 'error');
        return;
    }

    actionBusy.value = true;
    pendingAction.value = 'join';
    signalingStatus.value = 'joining';
    const credentials = createParticipantCredentials();
    const client = createSignalingClient();
    try {
        const request = buildConnectRequest(joinCode.value, credentials, false);
        const response = await retryConnect(() => client.joinSession(request));
        await activateSession(response, joinCode.value, false, credentials);
    } catch (error) {
        signalingStatus.value = 'error';
        showError(t('fileTransfer.messages.joinFailed'), error);
        teardownLocalSession();
    } finally {
        actionBusy.value = false;
        pendingAction.value = '';
    }
}

function createSignalingClient() {
    signalingClient?.stop();
    signalingClient = new WebRtcSignalingClient({
        onEvent: handleSignalingEvent,
        onSnapshot: handleSignalingSnapshot,
        onRejectedEvent: (event) => showToast(translateErrorMessage(event.code || event.message), 'warning'),
        onError: handleSignalingError
    });
    return signalingClient;
}

function handleSignalingError(error) {
    if (!sessionActive.value) return;
    const code = String(error?.code || '');
    const participantUnavailable = RECOVERABLE_PARTICIPANT_CODES.has(code) || [401, 403].includes(error?.status);
    if (participantUnavailable) {
        signalingStatus.value = 'reconnecting';
        if (isOwner.value) {
            scheduleSessionUnavailable();
        } else {
            scheduleSessionRecovery();
        }
        return;
    }
    if (TERMINAL_SESSION_CODES.has(code) || [404, 410].includes(error?.status)) {
        scheduleSessionUnavailable();
        return;
    }
    const wasReconnecting = signalingStatus.value === 'reconnecting';
    signalingStatus.value = 'reconnecting';
    if (!wasReconnecting) showToast(t('fileTransfer.messages.reconnecting'), 'warning');
}

function scheduleSessionRecovery() {
    if (recoveryScheduled || recoveryPromise || !sessionActive.value || isOwner.value) return;
    recoveryScheduled = true;
    setTimeout(() => {
        recoveryScheduled = false;
        if (!sessionActive.value || isOwner.value) return;
        recoveryPromise = recoverMemberSession().finally(() => {
            recoveryPromise = null;
        });
    }, 0);
}

async function recoverMemberSession() {
    if (!sessionCredentials || !/^\d{6}$/.test(sessionCode.value)) return;
    clearTimeout(recoveryTimer);
    recoveryTimer = null;
    const code = sessionCode.value;
    const credentials = sessionCredentials;
    const client = createSignalingClient();
    signalingStatus.value = 'reconnecting';
    try {
        const response = await retryConnect(() => client.joinSession(buildConnectRequest(code, credentials, false)));
        if (!sessionActive.value || sessionCredentials !== credentials || sessionCode.value !== code) return;
        await activateSession(response, code, false, credentials);
        showToast(t('fileTransfer.messages.reconnected'), 'success');
    } catch (error) {
        const errorCode = String(error?.code || '');
        if (TERMINAL_SESSION_CODES.has(errorCode) || [404, 410].includes(error?.status)) {
            handleSessionUnavailable();
            return;
        }
        signalingStatus.value = 'reconnecting';
        if (sessionActive.value) {
            recoveryTimer = setTimeout(scheduleSessionRecovery, 5_000);
        }
    }
}

function scheduleSessionUnavailable() {
    setTimeout(() => {
        if (sessionActive.value) handleSessionUnavailable();
    }, 0);
}

function handleSessionUnavailable() {
    if (!sessionActive.value) return;
    showToast(t('fileTransfer.messages.sessionUnavailable'), 'warning');
    teardownLocalSession({clearReceived: true});
}

function handleVisibilityChange() {
    if (document.visibilityState !== 'visible' || !sessionActive.value) return;
    resumeSessionActivity();
}

function handleNetworkOnline() {
    if (sessionActive.value) resumeSessionActivity();
}

function handlePageShow() {
    if (!sessionActive.value) return;
    if (pageLeaveNotified) {
        teardownLocalSession({clearReceived: true});
        return;
    }
    resumeSessionActivity();
}

function handlePageHide() {
    notifyLeave(true);
}

function notifyLeave(keepalive) {
    if (pageLeaveNotified || !sessionActive.value || !signalingClient) return;
    pageLeaveNotified = true;
    if (isOwner.value) void signalingClient.closeSession('PAGE_CLOSED', {keepalive}).catch(() => {});
    else void signalingClient.leaveSession('PAGE_CLOSED', {keepalive}).catch(() => {});
}

function resumeSessionActivity() {
    if (signalingClient?.active) {
        signalingStatus.value = 'reconnecting';
        signalingClient.requestSync();
    } else if (!isOwner.value) {
        scheduleSessionRecovery();
    } else {
        handleSessionUnavailable();
    }
}

async function activateSession(response, code, owner, credentials) {
    closePeerContexts();
    session.value = response;
    sessionCode.value = code;
    isOwner.value = owner;
    sessionCredentials = credentials;
    sessionActive.value = true;
    pageLeaveNotified = false;
    signalingStatus.value = 'polling';
    participants.value = [];
    selectedTargetId.value = '';
    incomingOfferParticipantId.value = '';
    incomingActionBusy.value = false;
    const participantSync = syncParticipants(response.participants || []);
    signalingClient.start();
    await participantSync;
}

async function handleSignalingEvent(event) {
    if (event.type === 'participant.joined') {
        const participant = participantFromEvent(event);
        showToast(t('fileTransfer.messages.peerJoined', {device: participant.displayName}), 'info');
        await syncParticipants([
            ...participants.value.filter((item) => item.participantId !== participant.participantId),
            participant
        ]);
        return;
    }
    if (event.type === 'participant.left') {
        const participantId = event.payload?.participantId || event.sourceParticipantId;
        const participant = participants.value.find((item) => item.participantId === participantId);
        removePeerContext(participantId);
        showToast(t('fileTransfer.messages.peerLeft', {device: participant?.displayName || t('common.unknown')}), 'warning');
        return;
    }
    if (event.type === 'session.closed') {
        handleRemoteSessionClosed(event.payload?.reason);
        return;
    }
    if (event.type.startsWith('webrtc.')) {
        await peerContexts.get(event.sourceParticipantId)?.peerConnection.handleSignal(event);
    }
}

async function handleSignalingSnapshot(snapshot) {
    if (!sessionActive.value) return;
    if (snapshot.sessionState === 'CLOSED') {
        handleRemoteSessionClosed(snapshot.sessionCloseReason);
        return;
    }
    signalingStatus.value = 'online';
    await syncParticipants(snapshot.participants || []);
}

async function syncParticipants(nextParticipants) {
    if (!sessionActive.value) return;
    const unique = [];
    const desiredIds = new Set();
    for (const participant of nextParticipants || []) {
        if (!participant?.participantId || desiredIds.has(participant.participantId)) continue;
        desiredIds.add(participant.participantId);
        unique.push(participant);
    }

    for (const participantId of [...peerContexts.keys()]) {
        if (!desiredIds.has(participantId)) removePeerContext(participantId);
    }

    const updates = unique.map((participant) => upsertPeerContext(participant));
    participants.value = unique;
    ensureSelectedTarget();
    await Promise.allSettled(updates);
}

function upsertPeerContext(participant) {
    const existing = peerContexts.get(participant.participantId);
    if (existing) {
        existing.participant = participant;
        return connectPeerContext(existing, participant, shouldReconnectPeer(existing));
    }
    return createPeerContext(participant);
}

function createPeerContext(participant) {
    const context = {
        participant,
        peerStatus: 'connecting',
        channelStatus: 'connecting',
        peerConnection: null,
        fileTransfer: null,
        selectedFiles: [],
        outgoingTransfer: null,
        incomingTransfer: null
    };

    context.fileTransfer = new WebRtcFileTransfer({
        onIncomingOffer: (transfer) => handleIncomingOffer(context, transfer),
        onIncomingState: (transfer) => updateIncomingTransfer(context, transfer),
        onOutgoingState: (transfer) => updateOutgoingTransfer(context, transfer),
        onSendProgress: (transfer) => updateOutgoingTransfer(context, transfer),
        onReceiveProgress: (transfer) => updateIncomingTransfer(context, transfer),
        onFileReceived: (file) => {
            if (isCurrentPeerContext(context)) addReceivedFile(file, context.participant);
        },
        onError: (error) => {
            if (isCurrentPeerContext(context)) {
                showError(t('fileTransfer.messages.transferFailed', {message: error?.message || t('common.unknown')}));
            }
        }
    });

    context.peerConnection = new WebRtcPeerConnection({
        iceServers: config.value.iceServers || [],
        initiator: shouldInitiateConnection(participant.participantId),
        sendSignal: (event) => signalingClient?.sendEvent(event),
        callbacks: {
            onConnectionState: (state) => {
                if (!isCurrentPeerContext(context)) return;
                context.peerStatus = normalizePeerState(state);
                refreshParticipants();
            },
            onChannelState: (state) => {
                if (!isCurrentPeerContext(context)) return;
                context.channelStatus = normalizeChannelState(state);
                refreshParticipants();
            },
            onChannelsReady: (channels) => {
                if (!isCurrentPeerContext(context)) return;
                context.fileTransfer.attach(channels);
                context.channelStatus = 'connected';
                refreshParticipants();
                showToast(t('fileTransfer.messages.connectionReadyFor', {device: context.participant.displayName}), 'success');
            },
            onError: (error) => {
                if (!isCurrentPeerContext(context)) return;
                showError(t('fileTransfer.messages.connectionFailed', {device: context.participant.displayName}), error);
            }
        }
    });

    peerContexts.set(participant.participantId, context);
    return connectPeerContext(context, participant);
}

async function connectPeerContext(context, participant, reconnect = false) {
    try {
        if (reconnect) await context.peerConnection.reconnect();
        else await context.peerConnection.setPeer(participant);
    } catch (error) {
        if (!isCurrentPeerContext(context)) return;
        context.peerStatus = 'failed';
        context.channelStatus = 'closed';
        refreshParticipants();
        showError(t('fileTransfer.messages.connectionFailed', {device: context.participant.displayName}), error);
    }
}

function shouldReconnectPeer(context) {
    return ['failed', 'disconnected', 'closed'].includes(context.peerStatus)
        || (context.peerStatus === 'connected' && context.channelStatus === 'closed');
}

function removePeerContext(participantId) {
    const context = peerContexts.get(participantId);
    if (context) {
        context.fileTransfer.close();
        context.peerConnection.close();
        peerContexts.delete(participantId);
    }
    participants.value = participants.value.filter((participant) => participant.participantId !== participantId);
    if (incomingOfferParticipantId.value === participantId) incomingOfferParticipantId.value = '';
    if (selectedTargetId.value === participantId) selectedTargetId.value = '';
    ensureSelectedTarget();
    selectNextIncomingOffer();
}

function closePeerContexts() {
    for (const context of peerContexts.values()) {
        context.fileTransfer.close();
        context.peerConnection.close();
    }
    peerContexts.clear();
}

function handleIncomingOffer(context, transfer) {
    updateIncomingTransfer(context, transfer);
}

function updateIncomingTransfer(context, transfer) {
    if (!isCurrentPeerContext(context)) return;
    context.incomingTransfer = {
        ...transfer,
        sourceParticipantId: context.participant.participantId,
        sourceName: context.participant.displayName
    };
    if (transfer.status === 'offering' && !incomingOfferParticipantId.value) {
        incomingOfferParticipantId.value = context.participant.participantId;
    } else if (incomingOfferParticipantId.value === context.participant.participantId && transfer.status !== 'offering') {
        incomingOfferParticipantId.value = '';
        selectNextIncomingOffer();
    }
    refreshParticipants();
}

function updateOutgoingTransfer(context, transfer) {
    if (!isCurrentPeerContext(context)) return;
    context.outgoingTransfer = {
        ...transfer,
        targetParticipantId: context.participant.participantId,
        targetName: context.participant.displayName
    };
    if (transfer.status === 'completed') context.selectedFiles = [];
    refreshParticipants();
}

function isCurrentPeerContext(context) {
    return sessionActive.value && peerContexts.get(context.participant.participantId) === context;
}

function refreshParticipants() {
    participants.value = [...participants.value];
}

function ensureSelectedTarget() {
    if (participants.value.some((participant) => participant.participantId === selectedTargetId.value)) return;
    const connected = participants.value.find((participant) => participantChannelStatus(participant.participantId) === 'connected');
    selectedTargetId.value = (connected || participants.value[0])?.participantId || '';
}

function selectTarget(participantId) {
    if (!peerContexts.has(participantId)) return;
    selectedTargetId.value = participantId;
}

function selectNextIncomingOffer() {
    incomingOfferParticipantId.value = findIncomingOfferParticipantId(incomingOfferParticipantId.value);
}

function participantChannelStatus(participantId) {
    return peerContexts.get(participantId)?.channelStatus || 'connecting';
}

function connectionStatusText(state) {
    const normalized = ['new', 'checking'].includes(state) ? 'connecting' : state;
    return t(`fileTransfer.connection.${normalized}`);
}

function participantDeviceDetail(participant) {
    const metadata = participant?.metadata || {};
    const details = [metadata.browser, metadata.platform].filter(Boolean);
    if (metadata.deviceCode && !String(participant?.displayName || '').includes(metadata.deviceCode)) {
        details.push(`#${metadata.deviceCode}`);
    }
    return details.join(' · ') || t('fileTransfer.devices.unknown');
}

function participantDeviceIcon(participant) {
    const metadata = participant?.metadata || {};
    const platform = String(metadata.platform || '').toLowerCase();
    if (metadata.mobile || /android|iphone|ipad|mobile/.test(platform)) return 'fas fa-mobile-screen-button';
    return 'fas fa-laptop';
}

function shouldInitiateConnection(participantId) {
    return String(session.value?.participantId || '') < String(participantId || '');
}

function handleRemoteSessionClosed() {
    if (!sessionActive.value) return;
    showToast(t('fileTransfer.messages.sessionClosed'), 'warning');
    teardownLocalSession({clearReceived: true});
}

async function endSession() {
    if (!sessionActive.value) return;
    try {
        if (isOwner.value) await signalingClient?.closeSession('USER_CLOSED');
        else await signalingClient?.leaveSession('USER_LEFT');
    } catch (error) {
        if (![404, 410].includes(error?.status)) showError(t('common.error.requestFailed'), error);
    } finally {
        teardownLocalSession({clearReceived: true});
    }
}

function handleSessionAction() {
    void endSession();
}

function teardownLocalSession({clearReceived = false} = {}) {
    sessionActive.value = false;
    signalingClient?.stop();
    closePeerContexts();
    clearTimeout(recoveryTimer);
    recoveryTimer = null;
    recoveryScheduled = false;
    recoveryPromise = null;
    signalingClient = null;
    sessionCredentials = null;
    session.value = null;
    sessionCode.value = '';
    joinCode.value = '';
    participants.value = [];
    selectedTargetId.value = '';
    incomingOfferParticipantId.value = '';
    incomingActionBusy.value = false;
    signalingStatus.value = config.value ? 'idle' : 'error';
    fileSelectionTargetId = '';
    pageLeaveNotified = false;
    if (clearReceived) clearReceivedFiles();
}

function openFilePicker() {
    if (!selectedTarget.value) {
        showToast(t('fileTransfer.files.targetRequired'), 'warning');
        return;
    }
    if (outgoingBusy.value) return;
    fileSelectionTargetId = selectedTarget.value.participantId;
    fileInput.value?.click();
}

function handleFileSelection(event) {
    const files = Array.from(event.target.files || []);
    const context = peerContexts.get(fileSelectionTargetId);
    fileSelectionTargetId = '';
    if (!context) {
        event.target.value = '';
        return;
    }
    if (isOutgoingTransferActive(context.outgoingTransfer)) {
        event.target.value = '';
        return;
    }
    const existing = new Set(context.selectedFiles.map((file) => fileKey(file)));
    context.selectedFiles = [
        ...context.selectedFiles,
        ...files.filter((file) => !existing.has(fileKey(file)))
    ];
    refreshParticipants();
    event.target.value = '';
}

function removeSelectedFile(index) {
    const context = peerContexts.get(selectedTargetId.value);
    if (!context) return;
    context.selectedFiles = context.selectedFiles.filter((_, fileIndex) => fileIndex !== index);
    refreshParticipants();
}

function clearSelectedFiles() {
    const context = peerContexts.get(selectedTargetId.value);
    if (!context) return;
    context.selectedFiles = [];
    refreshParticipants();
}

function sendSelectedFiles() {
    if (!selectedFiles.value.length) {
        fileInput.value?.click();
        return;
    }
    const context = peerContexts.get(selectedTargetId.value);
    if (!context) {
        showToast(t('fileTransfer.messages.targetRequired'), 'warning');
        return;
    }
    if (context.channelStatus !== 'connected') {
        showToast(t('fileTransfer.messages.targetNotReady', {device: context.participant.displayName}), 'warning');
        return;
    }
    try {
        context.fileTransfer.offerFiles(context.selectedFiles);
    } catch (error) {
        showError(t('fileTransfer.messages.transferFailed', {message: error?.message || t('common.unknown')}));
    }
}

function cancelOutgoingTransfer(participantId) {
    peerContexts.get(participantId)?.fileTransfer.cancelOutgoing();
}

function rejectIncomingTransfer() {
    if (incomingActionBusy.value) return;
    incomingOfferContext.value?.fileTransfer.rejectIncoming();
}

async function acceptIncomingInBrowser() {
    if (incomingActionBusy.value) return;
    const transfer = incomingOffer.value;
    const context = incomingOfferContext.value;
    if (!transfer || !context) return;
    incomingActionBusy.value = true;
    const transferId = transfer.transferId;
    const targets = [];
    try {
        const createTarget = (file) => prepareDownload({
                fileName: file.name,
                size: file.size,
                mimeType: file.type,
                allowFileAccess: transfer.files.length === 1
            });
        targets.push(await createTarget(transfer.files[0]));
        if (targets[0].method === 'blob') {
            const oversized = transfer.files.find((file) => file.size > DEFAULT_MAX_BLOB_DOWNLOAD_BYTES);
            if (oversized) throw createBlobSizeLimitError(oversized.size);
        }
        if (!isCurrentIncomingOffer(context, transferId)) {
            await Promise.allSettled(targets.map((target) => target.abort(new Error('INCOMING_OFFER_CHANGED'))));
            return;
        }
        await context.fileTransfer.acceptIncoming({targets, createTarget, expectedTransferId: transferId});
    } catch (error) {
        await Promise.allSettled(targets.filter((target) => !target.done).map((target) => target.abort(error)));
        if (error?.name === 'AbortError') return;
        showError(t('fileTransfer.messages.transferFailed', {message: error?.message || t('common.unknown')}));
    } finally {
        incomingActionBusy.value = false;
    }
}

async function acceptIncomingToFolder() {
    if (incomingActionBusy.value) return;
    if (!supportsDirectoryPicker.value) {
        showToast(t('fileTransfer.messages.folderUnavailable'), 'warning');
        return;
    }
    const context = incomingOfferContext.value;
    if (!context) return;
    const transferId = incomingOffer.value?.transferId;
    incomingActionBusy.value = true;
    try {
        const directoryHandle = await window.showDirectoryPicker({mode: 'readwrite'});
        if (!isCurrentIncomingOffer(context, transferId)) return;
        await context.fileTransfer.acceptIncoming({directoryHandle, expectedTransferId: transferId});
    } catch (error) {
        if (error?.name === 'AbortError') {
            showToast(t('fileTransfer.messages.folderCancelled'), 'info');
            return;
        }
        showError(t('fileTransfer.messages.transferFailed', {message: error?.message || t('common.unknown')}));
    } finally {
        incomingActionBusy.value = false;
    }
}

function isCurrentIncomingOffer(context, transferId) {
    return isCurrentPeerContext(context)
        && context.incomingTransfer?.transferId === transferId
        && context.incomingTransfer.status === 'offering';
}

function addReceivedFile(file, participant) {
    const entry = {
        ...file,
        id: `${participant.participantId}:${file.transferId}:${file.fileIndex}`,
        sourceParticipantId: participant.participantId,
        sourceName: participant.displayName
    };
    receivedFiles.value = [entry, ...receivedFiles.value];
}

function clearReceivedFiles() {
    receivedFiles.value = [];
}

async function copySessionCode() {
    try {
        await navigator.clipboard.writeText(sessionCode.value);
        showToast(t('fileTransfer.session.copied'), 'success');
    } catch {
        showToast(t('common.copyFailedManual'), 'warning');
    }
}

function updateJoinCode(event) {
    joinCode.value = String(event.target.value || '').replace(/\D/g, '').slice(0, 6);
    event.target.value = formatConnectionCode(joinCode.value);
}

function validateDeviceName() {
    if (deviceName.value.trim()) return true;
    showToast(t('fileTransfer.messages.deviceNameRequired'), 'warning');
    return false;
}

function buildConnectRequest(code, credentials, owner) {
    return {
        sessionKey: code,
        application: 'file-transfer',
        applicationVersion: 1,
        ...(owner ? {maxParticipants: configuredMaxParticipants.value} : {}),
        participant: {
            clientId: credentials.clientId,
            clientKey: credentials.clientKey,
            displayName: deviceName.value.trim(),
            capabilities: [
                'webrtc-data-channel',
                'file-transfer-v1',
                ...(supportsDirectoryPicker.value ? ['file-system-access'] : [])
            ],
            metadata: browserMetadata()
        },
        ...(owner ? {metadata: {purpose: 'browser-file-transfer'}} : {})
    };
}

function participantFromEvent(event) {
    const payload = event.payload || {};
    return {
        participantId: payload.participantId || event.sourceParticipantId,
        displayName: payload.displayName || t('common.unknown'),
        role: payload.role || 'MEMBER',
        capabilities: payload.capabilities || [],
        metadata: payload.metadata || null,
        joinedAt: payload.joinedAt || event.createdAt,
        lastActivityAt: event.createdAt
    };
}

function statusCard(labelKey, state, icon) {
    const normalized = ['new', 'checking'].includes(state) ? 'connecting' : state;
    return {
        label: t(labelKey),
        value: t(`fileTransfer.connection.${normalized}`),
        icon,
        dotClass: statusDotClass(normalized)
    };
}

function valueStatusCard(labelKey, value, state, icon) {
    return {
        label: t(labelKey),
        value,
        icon,
        dotClass: statusDotClass(state)
    };
}

function minimumPositiveLimit(value, fallback) {
    const normalized = Number(value);
    return Number.isSafeInteger(normalized) && normalized > 0 ? Math.min(normalized, fallback) : fallback;
}

function statusDotClass(state) {
    if (['connected', 'online'].includes(state)) return 'bg-green-500';
    if (['failed', 'error', 'closed'].includes(state)) return 'bg-red-500';
    if (['waiting', 'connecting', 'negotiating', 'polling', 'creating', 'joining', 'reconnecting', 'loadingConfig'].includes(state)) {
        return 'bg-amber-500';
    }
    return 'bg-gray-400';
}

function normalizePeerState(state) {
    if (state === 'new') return 'connecting';
    return ['waiting', 'negotiating', 'connecting', 'connected', 'disconnected', 'failed', 'closed'].includes(state)
        ? state
        : 'connecting';
}

function normalizeChannelState(state) {
    return ['connecting', 'connected', 'closed'].includes(state) ? state : 'connecting';
}

function transferStatusText(status) {
    const key = `fileTransfer.files.${status}`;
    return ['offering', 'sending', 'finishing', 'completed', 'rejected', 'cancelled', 'failed', 'receiving'].includes(status)
        ? t(key)
        : t('common.unknown');
}

function incomingStatusText(status) {
    return status === 'offering' ? t('fileTransfer.incoming.awaitingDecision') : transferStatusText(status);
}

function transferPercent(transfer) {
    return progressPercent(transfer?.sentBytes ?? transfer?.receivedBytes, transfer?.totalBytes);
}

function progressPercent(current = 0, total = 0) {
    if (!total) return current || total === 0 ? 100 : 0;
    return Math.min(100, Math.max(0, Math.round((current / total) * 100)));
}

function fileKey(file, index = '') {
    return `${file.name}:${file.size}:${file.lastModified}:${index}`;
}

function showToast(message, type = 'info') {
    toastRef.value?.show(message, type);
}

function showError(prefix, error = null) {
    const detail = error ? translateErrorMessage(error.code || error.message || error) : '';
    showToast(detail && detail !== prefix ? `${prefix}: ${detail}` : prefix, 'error');
}

async function retryConnect(action, attempts = 3) {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
            return await action();
        } catch (error) {
            lastError = error;
            if (error?.status || attempt === attempts - 1) throw error;
            await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
        }
    }
    throw lastError;
}

function generateConnectionCode() {
    const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
    const values = new Uint32Array(1);
    do {
        crypto.getRandomValues(values);
    } while (values[0] >= limit);
    return String(values[0] % 1_000_000).padStart(6, '0');
}

function createParticipantCredentials() {
    return {clientId: CommonUtils.createRandomUuid(), clientKey: randomToken(16)};
}

function randomToken(size) {
    const bytes = crypto.getRandomValues(new Uint8Array(size));
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function formatConnectionCode(value) {
    const code = String(value || '').replace(/\D/g, '').slice(0, 6);
    return code.length > 3 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

function readDeviceName(identityCode) {
    const platform = navigator.userAgentData?.platform || navigator.platform || '';
    const browser = detectBrowser();
    return [browser, platform, identityCode].filter(Boolean).join(' · ') || `Browser · ${identityCode}`;
}

function createDeviceIdentityCode() {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    return Array.from(bytes, (value) => DEVICE_CODE_ALPHABET[value & 31]).join('');
}

function detectBrowser() {
    const userAgent = navigator.userAgent || '';
    if (/Edg\//.test(userAgent)) return 'Edge';
    if (/Firefox\//.test(userAgent)) return 'Firefox';
    if (/Chrome\//.test(userAgent)) return 'Chrome';
    if (/Safari\//.test(userAgent)) return 'Safari';
    return 'Browser';
}

function browserMetadata() {
    return {
        platform: navigator.userAgentData?.platform || navigator.platform || '',
        browser: detectBrowser(),
        deviceCode: deviceIdentityCode,
        language: navigator.language || '',
        mobile: Boolean(navigator.userAgentData?.mobile)
    };
}
</script>
