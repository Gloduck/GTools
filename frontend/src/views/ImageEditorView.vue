<template>
<common-toast ref="toastRef"></common-toast>

        <div class="min-h-screen flex flex-col">
            <common-header :title="$route.meta.title" :icon="$route.meta.icon" link="/"></common-header>

            <main class="flex-grow container mx-auto px-4 py-8">
                <div class="max-w-7xl mx-auto">
                    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div class="lg:col-span-2 space-y-6">
                            <div class="bg-white rounded-xl shadow-lg p-6">
                                <div class="flex justify-between items-center mb-4">
                                    <h2 class="text-lg font-bold text-gray-800">
                                        <i class="fas fa-images mr-2 text-primary"></i>{{ $t('imageEditor.preview') }}
                                    </h2>
                                    <div class="flex gap-2">
                                        <button @click="clearAll" class="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors">
                                            <i class="fas fa-trash-alt mr-1"></i>{{ $t('common.clear') }}
                                        </button>
                                    </div>
                                </div>

                                <div v-if="images.length === 0" class="border-2 border-dashed border-gray-300 rounded-xl p-12 text-center">
                                    <i class="fas fa-cloud-upload-alt text-5xl text-gray-300 mb-4"></i>
                                    <p class="text-gray-500 mb-4">{{ $t('imageEditor.dropHint') }}</p>
                                    <input type="file" ref="fileInput" @change="handleFileSelect" accept="image/*" multiple class="hidden" id="fileInput">
                                    <label for="fileInput" class="px-6 py-3 bg-primary text-white rounded-lg cursor-pointer hover:bg-secondary transition-colors inline-block">
                                        <i class="fas fa-folder-open mr-2"></i>{{ $t('imageEditor.selectImages') }}
                                    </label>
                                </div>

                                <div v-else>
                                    <div v-if="selectedImage" class="mb-4">
                                        <div class="bg-gray-100 rounded-lg p-4 overflow-auto max-h-[500px]">
                                            <img v-if="operation === 'crop'" ref="cropperImage" :src="selectedImage.preview" class="max-w-full">
                                            <img v-else :src="selectedImage.preview" class="max-w-full">
                                        </div>
                                        <div class="flex justify-between items-center mt-4">
                                            <div class="text-sm text-gray-600">
                                                {{ selectedImage.name }} ({{ selectedImage.width }}x{{ selectedImage.height }}) | {{ formatFileSize(selectedImage.size) }}
                                            </div>
                                            <div class="flex gap-2">
                                                <button @click="prevImage" :disabled="currentIndex === 0" 
                                                    class="px-3 py-2 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed">
                                                    <i class="fas fa-chevron-left"></i>
                                                </button>
                                                <span class="px-3 py-2 text-gray-600">{{ currentIndex + 1 }} / {{ images.length }}</span>
                                                <button @click="nextImage" :disabled="currentIndex === images.length - 1"
                                                    class="px-3 py-2 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed">
                                                    <i class="fas fa-chevron-right"></i>
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    <div class="border-t pt-4 mt-4">
                                        <label for="fileInput2" class="inline-flex items-center px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 cursor-pointer transition-colors">
                                            <i class="fas fa-plus mr-2"></i>{{ $t('imageEditor.addMoreImages') }}
                                        </label>
                                        <input type="file" ref="fileInput2" @change="handleFileSelect" accept="image/*" multiple class="hidden" id="fileInput2">
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="space-y-6">
                            <div class="bg-white rounded-xl shadow-lg p-6">
                                <h2 class="text-lg font-bold text-gray-800 mb-4">
                                    <i class="fas fa-sliders-h mr-2 text-primary"></i>{{ $t('imageEditor.options') }}
                                </h2>

                                <div class="space-y-4">
                                    <div>
                                        <label class="block text-sm font-medium text-gray-700 mb-2">{{ $t('imageEditor.operationType') }}</label>
                                        <div class="grid grid-cols-2 gap-2">
                                            <button @click="operation = 'resize'" :class="operation === 'resize' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'"
                                                class="px-3 py-2 rounded-lg transition-colors text-sm">
                                                <i class="fas fa-expand mr-1"></i>{{ $t('imageEditor.resize') }}
                                            </button>
                                            <button @click="operation = 'compress'" :class="operation === 'compress' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'"
                                                class="px-3 py-2 rounded-lg transition-colors text-sm">
                                                <i class="fas fa-compress mr-1"></i>{{ $t('imageEditor.compress') }}
                                            </button>
                                            <button @click="operation = 'crop'" :class="operation === 'crop' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'"
                                                class="px-3 py-2 rounded-lg transition-colors text-sm">
                                                <i class="fas fa-crop mr-1"></i>{{ $t('imageEditor.crop') }}
                                            </button>
                                        </div>
                                    </div>

                                    <div v-if="operation === 'resize'">
                                        <label class="block text-sm font-medium text-gray-700 mb-2">{{ $t('imageEditor.resizeMode') }}</label>
                                        <div class="space-y-2">
                                            <label class="flex items-center">
                                                <input type="radio" v-model="resizeMode" value="scale" class="mr-2">
                                                <span class="text-sm">{{ $t('imageEditor.proportionalResize') }}</span>
                                            </label>
                                            <label class="flex items-center">
                                                <input type="radio" v-model="resizeMode" value="width" class="mr-2">
                                                <span class="text-sm">{{ $t('imageEditor.fixedWidth') }}</span>
                                            </label>
                                            <label class="flex items-center">
                                                <input type="radio" v-model="resizeMode" value="height" class="mr-2">
                                                <span class="text-sm">{{ $t('imageEditor.fixedHeight') }}</span>
                                            </label>
                                        </div>
                                    </div>

                                    <div v-if="operation === 'resize' && resizeMode === 'scale'">
                                        <label class="block text-sm font-medium text-gray-700 mb-2">
                                            {{ $t('imageEditor.resizeScale', { scale: resizeScale }) }}
                                        </label>
                                        <input type="range" v-model.number="resizeScale" min="10" max="200" class="w-full">
                                        <div class="flex justify-between text-xs text-gray-500 mt-1">
                                            <span>10%</span>
                                            <span>200%</span>
                                        </div>
                                    </div>

                                    <div v-if="operation === 'resize' && resizeMode === 'width'">
                                        <label class="block text-sm font-medium text-gray-700 mb-2">{{ $t('imageEditor.widthPx') }}</label>
                                        <input type="number" v-model.number="resizeWidth" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none">
                                    </div>

                                    <div v-if="operation === 'resize' && resizeMode === 'height'">
                                        <label class="block text-sm font-medium text-gray-700 mb-2">{{ $t('imageEditor.heightPx') }}</label>
                                        <input type="number" v-model.number="resizeHeight" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none">
                                    </div>

                                    <div v-if="operation === 'compress'">
                                        <label class="block text-sm font-medium text-gray-700 mb-2">
                                            {{ $t('imageEditor.compressionQuality', { quality: compressQuality * 100 }) }}
                                        </label>
                                        <input type="range" v-model.number="compressQuality" min="0.1" max="1" step="0.1" class="w-full">
                                        <div class="flex justify-between text-xs text-gray-500 mt-1">
                                            <span>10%</span>
                                            <span>100%</span>
                                        </div>
                                    </div>

                                    <div v-if="operation === 'compress'">
                                        <label class="block text-sm font-medium text-gray-700 mb-2">{{ $t('imageEditor.maxWidthPx') }}</label>
                                        <input type="number" v-model="maxWidth" :placeholder="$t('imageEditor.unlimited')" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none">
                                    </div>

                                    <div v-if="operation === 'compress'">
                                        <label class="block text-sm font-medium text-gray-700 mb-2">{{ $t('imageEditor.maxHeightPx') }}</label>
                                        <input type="number" v-model="maxHeight" :placeholder="$t('imageEditor.unlimited')" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none">
                                    </div>

                                    <div v-if="operation === 'crop'">
                                        <label class="block text-sm font-medium text-gray-700 mb-2">{{ $t('imageEditor.cropAspectRatio') }}</label>
                                        <div class="grid grid-cols-3 gap-2">
                                            <button @click="setAspectRatio(NaN)" :class="Number.isNaN(aspectRatio) ? 'bg-primary text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'"
                                                class="px-2 py-2 rounded-lg transition-colors text-xs">
                                                <i class="fas fa-expand mr-1"></i>{{ $t('imageEditor.freeAspectRatio') }}
                                            </button>
                                            <button @click="setAspectRatio(1)" :class="aspectRatio === 1 ? 'bg-primary text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'"
                                                class="px-2 py-2 rounded-lg transition-colors text-xs">
                                                <i class="fas fa-square mr-1"></i>1:1
                                            </button>
                                            <button @click="setAspectRatio(16/9)" :class="aspectRatio === 16/9 ? 'bg-primary text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'"
                                                class="px-2 py-2 rounded-lg transition-colors text-xs">
                                                <i class="fas fa-desktop mr-1"></i>16:9
                                            </button>
                                            <button @click="setAspectRatio(4/3)" :class="aspectRatio === 4/3 ? 'bg-primary text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'"
                                                class="px-2 py-2 rounded-lg transition-colors text-xs">
                                                <i class="fas fa-landscape mr-1"></i>4:3
                                            </button>
                                            <button @click="setAspectRatio(3/2)" :class="aspectRatio === 3/2 ? 'bg-primary text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'"
                                                class="px-2 py-2 rounded-lg transition-colors text-xs">
                                                <i class="fas fa-camera mr-1"></i>3:2
                                            </button>
                                            <button @click="setAspectRatio(9/16)" :class="aspectRatio === 9/16 ? 'bg-primary text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'"
                                                class="px-2 py-2 rounded-lg transition-colors text-xs">
                                                <i class="fas fa-mobile-alt mr-1"></i>9:16
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div class="bg-white rounded-xl shadow-lg p-6">
                                <h2 class="text-lg font-bold text-gray-800 mb-4">
                                    <i class="fas fa-play-circle mr-2 text-primary"></i>{{ $t('imageEditor.actions') }}
                                </h2>
                                <div class="space-y-3">
                                    <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                        <span class="text-sm text-gray-600">{{ $t('imageEditor.outputFormat') }}</span>
                                        <select v-model="outputFormat" class="px-2 py-1 border rounded text-sm">
                                            <option value="image/jpeg">JPEG</option>
                                            <option value="image/png">PNG</option>
                                            <option value="image/webp">WebP</option>
                                        </select>
                                    </div>
                                    <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                        <span class="text-sm text-gray-600">{{ $t('imageEditor.keepOriginalName') }}</span>
                                        <button @click="keepOriginalName = !keepOriginalName" 
                                            :class="keepOriginalName ? 'bg-green-500' : 'bg-gray-300'"
                                            class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors">
                                            <span :class="keepOriginalName ? 'translate-x-6' : 'translate-x-1'" 
                                                class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"></span>
                                        </button>
                                    </div>
                                </div>

                                <button @click="processCurrentImage" :disabled="!selectedImage || processing"
                                    class="w-full mt-4 px-6 py-3 bg-primary text-white rounded-lg hover:bg-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                                    <i v-if="processing" class="fas fa-spinner fa-spin mr-2"></i>
                                    <i v-else class="fas fa-check mr-2"></i>
                                    {{ processing ? $t('imageEditor.processing') : $t('imageEditor.applyCurrent') }}
                                </button>

                                <button v-if="operation === 'resize' || operation === 'compress'" 
                                    @click="processAllImages" :disabled="images.length === 0 || processing"
                                    class="w-full mt-2 px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                                    <i class="fas fa-copy mr-2"></i>{{ $t('imageEditor.applyAll') }}
                                </button>

                                <div class="flex gap-2 mt-3">
                                    <button @click="restoreImage" :disabled="!selectedImage"
                                        class="flex-1 px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                                        <i class="fas fa-undo mr-1"></i>{{ $t('imageEditor.restoreImage') }}
                                    </button>
                                    <button @click="downloadCurrentImage" :disabled="!selectedImage"
                                        class="flex-1 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                                        <i class="fas fa-download mr-1"></i>{{ $t('imageEditor.downloadCurrent') }}
                                    </button>
                                </div>

                                <button @click="downloadAllImages" :disabled="images.length === 0"
                                    class="w-full mt-3 px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                                    <i class="fas fa-download mr-2"></i>{{ $t('imageEditor.downloadAll', { count: images.length }) }}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </main>

            <common-footer copyright="© 2025 Gloduck"></common-footer>
        </div>
</template>

<script>
import { ref, watch, nextTick, onUnmounted } from 'vue';
import { CommonUtils } from '@/shared/common-utils.js';
import { CdnUtils } from '@/shared/cdn-utils.js';
import { ImageUtils } from '@/shared/image-utils.js';
import { CommonComponents } from '@/shared/common-components.js';
import { t } from '@/i18n/index.js';

export default {
    name: 'ImageEditorView',
            components: {
                'common-header': CommonComponents.Header,
                'common-footer': CommonComponents.Footer,
                'common-toast': CommonComponents.Toast
            },

            setup() {
                const toastRef = ref(null);
                const fileInput = ref(null);
                const cropperImage = ref(null);
                let cropper = null;
                let CropperClass = null;

                const images = ref([]);
                const selectedImage = ref(null);
                const currentIndex = ref(0);
                const processing = ref(false);

                const operation = ref('resize');
                const resizeMode = ref('scale');
                const resizeScale = ref(50);
                const resizeWidth = ref(800);
                const resizeHeight = ref(600);
                const compressQuality = ref(0.8);
                const maxWidth = ref(null);
                const maxHeight = ref(null);
                const outputFormat = ref('image/jpeg');
                const keepOriginalName = ref(true);

                const aspectRatio = ref(NaN);

                const showToast = (message, type = 'success') => {
                    toastRef.value?.show(message, type);
                };

                const handleFileSelect = async (event) => {
                    const files = Array.from(event.target.files);
                    for (const file of files) {
                        if (!file.type.startsWith('image/')) {
                            showToast(t('imageEditor.invalidImageFile'), 'error');
                            continue;
                        }

                        const dimensions = await ImageUtils.getImageDimensions(file);
                        const preview = await ImageUtils.imageToBase64(file);

                        images.value.push({
                            file: file,
                            originalFile: file,
                            name: file.name,
                            width: dimensions.width,
                            height: dimensions.height,
                            size: file.size,
                            preview: preview
                        });
                    }

                    if (images.value.length > 0 && !selectedImage.value) {
                        currentIndex.value = images.value.length - files.length;
                        updateSelectedImage();
                    }

                    event.target.value = '';
                };

                const updateSelectedImage = async () => {
                    if (images.value.length === 0) {
                        selectedImage.value = null;
                        return;
                    }

                    selectedImage.value = images.value[currentIndex.value];
                    await nextTick();
                    await initCropper();
                };

                const initCropper = async () => {
                    if (cropper) {
                        cropper.destroy();
                        cropper = null;
                    }

                    if (!cropperImage.value || !selectedImage.value) return;

                    try {
                        CropperClass = CropperClass || await CdnUtils.loadCropper();
                    } catch (error) {
                        console.error('Failed to load Cropper:', error);
                        showToast(t('imageEditor.cropperLoadFailed', { message: error.message }), 'error');
                        return;
                    }

                    cropper = new CropperClass(cropperImage.value, {
                        aspectRatio: isNaN(aspectRatio.value) ? NaN : aspectRatio.value,
                        viewMode: 1,
                        autoCropArea: 0.8,
                        responsive: true,
                        crop() {
                        }
                    });
                };

                const setAspectRatio = (ratio) => {
                    aspectRatio.value = ratio;
                    if (cropper) {
                        cropper.setAspectRatio(isNaN(ratio) ? NaN : ratio);
                    }
                };

                const prevImage = () => {
                    if (currentIndex.value > 0) {
                        currentIndex.value--;
                        updateSelectedImage();
                    }
                };

                const nextImage = () => {
                    if (currentIndex.value < images.value.length - 1) {
                        currentIndex.value++;
                        updateSelectedImage();
                    }
                };

                const clearAll = () => {
                    images.value = [];
                    selectedImage.value = null;
                    currentIndex.value = 0;
                    if (cropper) {
                        cropper.destroy();
                        cropper = null;
                    }
                    showToast(t('imageEditor.clearedAll'));
                };

                const processCurrentImage = async () => {
                    if (!selectedImage.value) {
                        showToast(t('imageEditor.selectImageFirst'), 'error');
                        return;
                    }

                    processing.value = true;

                    try {
                        const imgData = selectedImage.value;
                        let result;

                        if (operation.value === 'resize') {
                            result = await processResize(imgData);
                        } else if (operation.value === 'compress') {
                            result = await processCompress(imgData);
                        } else if (operation.value === 'crop') {
                            result = await processCrop(imgData);
                        }

                        if (result) {
                            const idx = currentIndex.value;
                            images.value[idx] = result;
                            selectedImage.value = result;
                            await nextTick();
                            if (operation.value === 'crop') {
                                await initCropper();
                            }
                            showToast(t('imageEditor.processComplete'));
                        }
                    } catch (error) {
                        console.error('处理失败:', error);
                        showToast(t('imageEditor.processFailed', { message: error.message }), 'error');
                    } finally {
                        processing.value = false;
                    }
                };

                const processAllImages = async () => {
                    if (images.value.length === 0) {
                        showToast(t('imageEditor.selectImageFirst'), 'error');
                        return;
                    }

                    processing.value = true;

                    try {
                        for (let i = 0; i < images.value.length; i++) {
                            const imgData = images.value[i];
                            let result;

                            if (operation.value === 'resize') {
                                result = await processResize(imgData);
                            } else if (operation.value === 'compress') {
                                result = await processCompress(imgData);
                            }

                            if (result) {
                                images.value[i] = result;
                            }
                        }

                        selectedImage.value = images.value[currentIndex.value];
                        await nextTick();
                        showToast(t('imageEditor.processedCount', { count: images.value.length }));
                    } catch (error) {
                        console.error('处理失败:', error);
                        showToast(t('imageEditor.processFailed', { message: error.message }), 'error');
                    } finally {
                        processing.value = false;
                    }
                };

                const processResize = async (imgData) => {
                    const img = new Image();
                    await new Promise((resolve) => {
                        img.onload = resolve;
                        img.src = imgData.preview;
                    });

                    let newWidth, newHeight;

                    if (resizeMode.value === 'scale') {
                        const scale = resizeScale.value / 100;
                        newWidth = Math.round(img.width * scale);
                        newHeight = Math.round(img.height * scale);
                    } else if (resizeMode.value === 'width') {
                        newWidth = resizeWidth.value;
                        const ratio = newWidth / img.width;
                        newHeight = Math.round(img.height * ratio);
                    } else {
                        newHeight = resizeHeight.value;
                        const ratio = newHeight / img.height;
                        newWidth = Math.round(img.width * ratio);
                    }

                    const canvas = document.createElement('canvas');
                    canvas.width = newWidth;
                    canvas.height = newHeight;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, newWidth, newHeight);

                    const blob = await new Promise(resolve => canvas.toBlob(resolve, outputFormat.value, 0.95));
                    const preview = URL.createObjectURL(blob);

                    return {
                        file: blob,
                        originalFile: imgData.originalFile,
                        name: imgData.name,
                        width: newWidth,
                        height: newHeight,
                        size: blob.size,
                        preview: preview
                    };
                };

                const processCompress = async (imgData) => {
                    const result = await ImageUtils.compressImage(imgData.file, maxWidth.value, maxHeight.value, compressQuality.value);
                    const blob = result.blob;
                    const preview = URL.createObjectURL(blob);

                    const ext = outputFormat.value.split('/')[1];
                    const nameParts = imgData.name.split('.');
                    nameParts.pop();
                    const baseName = nameParts.join('.');
                    const name = keepOriginalName.value ? imgData.name : `${baseName}_compressed.${ext}`;

                    return {
                        file: blob,
                        originalFile: imgData.originalFile,
                        name: name,
                        width: result.width,
                        height: result.height,
                        size: blob.size,
                        preview: preview,
                        originalSize: imgData.size,
                        compressionRatio: result.compressionRatio
                    };
                };

                const processCrop = async (imgData) => {
                    if (!cropper) {
                        const img = new Image();
                        await new Promise((resolve) => {
                            img.onload = resolve;
                            img.src = imgData.preview;
                        });

                        const canvas = document.createElement('canvas');
                        canvas.width = img.width;
                        canvas.height = img.height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0);

                        const blob = await new Promise(resolve => canvas.toBlob(resolve, outputFormat.value, 0.95));
                        const preview = URL.createObjectURL(blob);

                        return {
                            file: blob,
                            originalFile: imgData.originalFile,
                            name: imgData.name,
                            width: img.width,
                            height: img.height,
                            size: blob.size,
                            preview: preview
                        };
                    }

                    const croppedCanvas = cropper.getCroppedCanvas({
                        maxWidth: 4096,
                        maxHeight: 4096
                    });

                    const blob = await new Promise(resolve => croppedCanvas.toBlob(resolve, outputFormat.value, 0.95));
                    const preview = URL.createObjectURL(blob);

                    const ext = outputFormat.value.split('/')[1];
                    const nameParts = imgData.name.split('.');
                    nameParts.pop();
                    const baseName = nameParts.join('.');
                    const name = keepOriginalName.value ? imgData.name : `${baseName}_cropped.${ext}`;

                    return {
                        file: blob,
                        originalFile: imgData.originalFile,
                        name: name,
                        width: Math.round(croppedCanvas.width),
                        height: Math.round(croppedCanvas.height),
                        size: blob.size,
                        preview: preview
                    };
                };

                const downloadSingle = (index) => {
                    const img = images.value[index];
                    ImageUtils.downloadImage(img.preview, img.name);
                };

                const downloadCurrentImage = () => {
                    if (selectedImage.value) {
                        ImageUtils.downloadImage(selectedImage.value.preview, selectedImage.value.name);
                        showToast(t('imageEditor.downloadStarted'));
                    }
                };

                const downloadAllImages = () => {
                    images.value.forEach((img, index) => {
                        setTimeout(() => {
                            ImageUtils.downloadImage(img.preview, img.name);
                        }, index * 300);
                    });
                    showToast(t('imageEditor.downloadCountStarted', { count: images.value.length }));
                };

                const restoreImage = async () => {
                    if (!selectedImage.value) return;
                    
                    const originalFile = selectedImage.value.originalFile || selectedImage.value.file;
                    const dimensions = await ImageUtils.getImageDimensions(originalFile);
                    const preview = await ImageUtils.imageToBase64(originalFile);
                    
                    const idx = currentIndex.value;
                    images.value[idx] = {
                        file: originalFile,
                        originalFile: originalFile,
                        name: selectedImage.value.name,
                        width: dimensions.width,
                        height: dimensions.height,
                        size: originalFile.size,
                        preview: preview
                    };
                    selectedImage.value = images.value[idx];
                    
                    await nextTick();
                    if (operation.value === 'crop') {
                        await initCropper();
                    }
                    showToast(t('imageEditor.restored'));
                };

                watch(aspectRatio, (newVal) => {
                    if (cropper) {
                        cropper.setAspectRatio(isNaN(newVal) ? NaN : newVal);
                    }
                });

                watch(operation, async (newVal) => {
                    if (newVal === 'crop') {
                        aspectRatio.value = NaN;
                        await nextTick();
                        setTimeout(() => {
                            if (selectedImage.value) {
                                initCropper();
                            }
                        }, 100);
                    } else {
                        if (cropper) {
                            cropper.destroy();
                            cropper = null;
                        }
                    }
                });

                onUnmounted(() => {
                    if (cropper) {
                        cropper.destroy();
                    }
                });

                return {
                    toastRef,
                    fileInput,
                    cropperImage,
                    images,
                    selectedImage,
                    currentIndex,
                    processing,
                    operation,
                    resizeMode,
                    resizeScale,
                    resizeWidth,
                    resizeHeight,
                    compressQuality,
                    maxWidth,
                    maxHeight,
                    outputFormat,
                    keepOriginalName,
                    aspectRatio,
                    handleFileSelect,
                    setAspectRatio,
                    prevImage,
                    nextImage,
                    clearAll,
                    processCurrentImage,
                    processAllImages,
                    downloadCurrentImage,
                    downloadAllImages,
                    restoreImage,
                    formatFileSize: CommonUtils.formatFileSize
                };
            }
};
</script>

<style>
.cropper-view-box,
        .cropper-face {
            border-radius: 0;
        }
        .cropper-view-box {
            outline: 2px solid #249ffd;
            outline-offset: -2px;
        }
</style>
