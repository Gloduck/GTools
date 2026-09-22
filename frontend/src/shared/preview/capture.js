export function createPreviewCapture(getFrame, changed) {
    let stream, video;
    let generation = 0;
    let state = {status: 'idle', error: null};
    const publish = (status, error = null) => { state = {status, error}; changed(); };
    const stop = () => {
        generation++;
        const previous = stream;
        stream = null;
        video?.pause();
        if (video) video.srcObject = null;
        video = null;
        previous?.getTracks().forEach((track) => track.stop());
        publish('idle');
    };
    return {
        getState: () => ({...state}),
        stop,
        async start() {
            if (state.status === 'active') return;
            stop();
            const current = generation;
            try {
                if (!getFrame()) throw new Error('Attach a preview frame before sharing');
                if (!navigator.userActivation?.isActive) throw new Error('Start capture from a user action');
                if (!globalThis.CropTarget?.fromElement || !navigator.mediaDevices?.getDisplayMedia) throw new Error('Preview-only Region Capture is not supported by this browser');
                publish('requesting');
                // 在任何异步等待之前打开选择器，保留浏览器要求的临时用户激活状态。
                const acquired = await navigator.mediaDevices.getDisplayMedia({
                    video: {frameRate: {ideal: 1}}, audio: false,
                    preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude',
                });
                if (current !== generation) { acquired.getTracks().forEach((track) => track.stop()); throw new Error('Capture cancelled'); }
                stream = acquired;
                const track = stream.getVideoTracks()[0];
                if (!track?.cropTo || track.getSettings().displaySurface !== 'browser') throw new Error('Select this browser tab; preview-only capture requires Region Capture');
                // 选择共享源时不设置帧率上限，选定后再约束视频轨道。
                await track.applyConstraints({frameRate: {ideal: 1, max: 1}});
                // 裁剪到当前文档的元素，也能拒绝误选其他标签页的情况。
                await track.cropTo(await CropTarget.fromElement(getFrame()));
                if (current !== generation || track.readyState === 'ended') throw new Error('Capture ended');
                video = document.createElement('video');
                video.muted = true;
                video.playsInline = true;
                video.srcObject = stream;
                track.addEventListener('ended', () => { if (current === generation) { stop(); publish('ended'); } }, {once: true});
                await video.play();
                if (current !== generation) throw new Error('Capture ended');
                publish('active');
            } catch (error) {
                if (current === generation) { stop(); publish('error', error.message); }
                throw error;
            }
        },
        async screenshot({timeoutMs = 5000} = {}, valid) {
            const current = generation;
            const source = video;
            if (state.status !== 'active' || !source) throw new Error('Start preview capture first');
            await new Promise((resolve, reject) => {
                let callback;
                const timer = setTimeout(() => finish(new Error('Timed out waiting for a capture frame')), Math.max(100, Math.min(30000, timeoutMs)));
                // 静态标签页可能停止产生新帧。先留出低帧率采集的更新时间，
                // 再使用已经解码的当前帧，避免只有动画页面才能截图。
                const idle = setTimeout(() => {
                    if (source.readyState >= 2) finish();
                }, Math.min(1200, Math.max(0, timeoutMs - 50)));
                const check = setInterval(() => {
                    if (current !== generation || !valid()) finish(new Error('Preview or capture changed'));
                }, 50);
                const finish = (error) => {
                    clearTimeout(timer);
                    clearTimeout(idle);
                    clearInterval(check);
                    if (callback != null) source.cancelVideoFrameCallback(callback);
                    error ? reject(error) : resolve();
                };
                if (!source.requestVideoFrameCallback) return finish(new Error('Video frame callbacks are not supported'));
                callback = source.requestVideoFrameCallback(() => finish());
            });
            if (current !== generation || !valid()) throw new Error('Preview or capture changed');
            const width = source.videoWidth, height = source.videoHeight;
            if (!width || !height) throw new Error('Capture has no video dimensions');
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            canvas.getContext('2d').drawImage(source, 0, 0);
            const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
            if (!blob || current !== generation || !valid()) throw new Error('Preview or capture changed');
            return {blob, width, height, capturedAt: Date.now()};
        },
    };
}
