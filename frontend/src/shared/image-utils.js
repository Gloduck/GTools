import {base64ToBlob, readFileAsDataUrl} from './file-utils.js';

const ImageUtils = {
    compressImage: (file, maxWidth = null, maxHeight = null, quality = 0.8) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    if ((maxWidth && width > maxWidth) || (maxHeight && height > maxHeight)) {
                        let ratio = 1;
                        if (maxWidth && maxHeight) {
                            ratio = Math.min(maxWidth / width, maxHeight / height);
                        } else if (maxWidth) {
                            ratio = maxWidth / width;
                        } else if (maxHeight) {
                            ratio = maxHeight / height;
                        }
                        width = width * ratio;
                        height = height * ratio;
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    canvas.toBlob((blob) => {
                        resolve({
                            blob: blob,
                            width: width,
                            height: height,
                            size: blob.size,
                            originalSize: file.size,
                            compressionRatio: (blob.size / file.size * 100).toFixed(2) + '%'
                        });
                    }, 'image/jpeg', quality);
                };
                img.onerror = reject;
                img.src = e.target.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    },

    getImageDimensions: (file) => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                resolve({
                    width: img.width,
                    height: img.height,
                    aspectRatio: (img.width / img.height).toFixed(2)
                });
            };
            img.onerror = reject;
            img.src = URL.createObjectURL(file);
        });
    },

    imageToBase64: readFileAsDataUrl,

    base64ToBlob,

    cropImage: (file, x, y, width, height) => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, x, y, width, height, 0, 0, width, height);

                canvas.toBlob((blob) => {
                    resolve({
                        blob: blob,
                        dataUrl: canvas.toDataURL('image/jpeg', 0.9)
                    });
                }, 'image/jpeg', 0.9);
            };
            img.onerror = reject;
            img.src = URL.createObjectURL(file);
        });
    },

    rotateImage: (file, degrees) => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const radians = degrees * Math.PI / 180;

                const sin = Math.abs(Math.sin(radians));
                const cos = Math.abs(Math.cos(radians));
                const newWidth = img.width * cos + img.height * sin;
                const newHeight = img.width * sin + img.height * cos;

                canvas.width = newWidth;
                canvas.height = newHeight;
                const ctx = canvas.getContext('2d');

                ctx.translate(newWidth / 2, newHeight / 2);
                ctx.rotate(radians);
                ctx.drawImage(img, -img.width / 2, -img.height / 2);

                canvas.toBlob((blob) => {
                    resolve({
                        blob: blob,
                        dataUrl: canvas.toDataURL('image/jpeg', 0.9)
                    });
                }, 'image/jpeg', 0.9);
            };
            img.onerror = reject;
            img.src = URL.createObjectURL(file);
        });
    },

    flipImage: (file, direction = 'horizontal') => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');

                if (direction === 'horizontal') {
                    ctx.translate(img.width, 0);
                    ctx.scale(-1, 1);
                } else {
                    ctx.translate(0, img.height);
                    ctx.scale(1, -1);
                }
                ctx.drawImage(img, 0, 0);

                canvas.toBlob((blob) => {
                    resolve({
                        blob: blob,
                        dataUrl: canvas.toDataURL('image/jpeg', 0.9)
                    });
                }, 'image/jpeg', 0.9);
            };
            img.onerror = reject;
            img.src = URL.createObjectURL(file);
        });
    },

    applyFilter: (file, filters = {}) => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');

                const filterStr = `
                    brightness(${filters.brightness || 100}%) 
                    contrast(${filters.contrast || 100}%) 
                    saturate(${filters.saturate || 100}%) 
                    grayscale(${filters.grayscale || 0}%) 
                    blur(${filters.blur || 0}px)
                `;
                ctx.filter = filterStr;
                ctx.drawImage(img, 0, 0);

                canvas.toBlob((blob) => {
                    resolve({
                        blob: blob,
                        dataUrl: canvas.toDataURL('image/jpeg', 0.9),
                        filters: filters
                    });
                }, 'image/jpeg', 0.9);
            };
            img.onerror = reject;
            img.src = URL.createObjectURL(file);
        });
    },

    addWatermark: (file, watermarkText, position = 'bottom-right') => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');

                ctx.drawImage(img, 0, 0);

                const fontSize = Math.max(16, img.width / 30);
                ctx.font = `${fontSize}px Arial`;
                ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                ctx.textAlign = 'right';
                ctx.textBaseline = 'bottom';

                ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
                ctx.shadowBlur = 4;
                ctx.shadowOffsetX = 2;
                ctx.shadowOffsetY = 2;

                let x, y;
                const padding = fontSize;

                switch (position) {
                    case 'top-left':
                        ctx.textAlign = 'left';
                        ctx.textBaseline = 'top';
                        x = padding;
                        y = padding;
                        break;
                    case 'top-right':
                        x = img.width - padding;
                        y = padding;
                        break;
                    case 'bottom-left':
                        ctx.textAlign = 'left';
                        x = padding;
                        y = img.height - padding;
                        break;
                    case 'bottom-right':
                    default:
                        x = img.width - padding;
                        y = img.height - padding;
                        break;
                    case 'center':
                        ctx.textAlign = 'center';
                        x = img.width / 2;
                        y = img.height / 2;
                        break;
                }

                ctx.fillText(watermarkText, x, y);

                canvas.toBlob((blob) => {
                    resolve({
                        blob: blob,
                        dataUrl: canvas.toDataURL('image/jpeg', 0.9)
                    });
                }, 'image/jpeg', 0.9);
            };
            img.onerror = reject;
            img.src = URL.createObjectURL(file);
        });
    },

    createPreview: (file, container, maxWidth = 300) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const scale = maxWidth / img.width;
                    const width = maxWidth;
                    const height = img.height * scale;

                    container.innerHTML = '';
                    container.style.width = width + 'px';
                    container.style.height = height + 'px';

                    img.style.width = '100%';
                    img.style.height = '100%';
                    img.style.objectFit = 'contain';

                    container.appendChild(img);
                    resolve({width, height, dataUrl: e.target.result});
                };
                img.onerror = reject;
                img.src = e.target.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }
};

export { ImageUtils };
