export const PREVIEW_VIEWPORT_MAX_SIZE = 8192;

export function createPreviewViewport(frame, container, onChange) {
    const properties = ['width', 'height', 'transform', 'transform-origin', 'left', 'top'];
    const original = properties.map((name) => [name, frame.style.getPropertyValue(name), frame.style.getPropertyPriority(name)]);
    let fixed = null, disposed = false, animation = null, initialized = false;
    let state = {viewport: {mode: 'container', width: 0, height: 0}, display: {width: 0, height: 0, scale: 0}, viewportReady: false};

    function refresh() {
        if (disposed) return false;
        const availableWidth = container.clientWidth, availableHeight = container.clientHeight;
        const width = fixed?.width ?? availableWidth, height = fixed?.height ?? availableHeight;
        const scale = width && height ? Math.min(1, availableWidth / width, availableHeight / height) : 0;
        const viewport = {mode: fixed ? 'fixed' : 'container', width, height};
        const display = {width: width * scale, height: height * scale, scale};
        const changed = width !== state.viewport.width || height !== state.viewport.height
            || display.width !== state.display.width || display.height !== state.display.height || scale !== state.display.scale;
        const modeChanged = viewport.mode !== state.viewport.mode;
        if (!changed && initialized) {
            if (modeChanged) { state = {...state, viewport}; onChange(false); }
            return false;
        }
        initialized = true;
        state = {viewport, display, viewportReady: false};
        for (const [name, value] of Object.entries({width: `${width}px`, height: `${height}px`, transform: `scale(${scale})`, 'transform-origin': 'top left', left: '0px', top: '0px'})) {
            frame.style.setProperty(name, value);
        }
        cancelAnimationFrame(animation);
        animation = null;
        if (scale > 0) {
            // 连续两帧布局不变后才允许截图，期间发生尺寸变化则重新等待。
            animation = requestAnimationFrame(() => {
                animation = requestAnimationFrame(() => {
                    animation = null;
                    if (disposed || refresh()) return;
                    state = {...state, viewportReady: true};
                    onChange(false);
                });
            });
        }
        onChange(changed);
        return changed;
    }

    const observer = new ResizeObserver(refresh);
    observer.observe(container);
    return {
        getState: () => ({viewport: {...state.viewport}, display: {...state.display}, viewportReady: state.viewportReady}),
        refresh,
        setViewport(value) {
            if (disposed) throw new Error('Preview viewport is detached');
            if (value !== null && (!Number.isInteger(value?.width) || !Number.isInteger(value?.height)
                || value.width < 1 || value.height < 1 || value.width > PREVIEW_VIEWPORT_MAX_SIZE || value.height > PREVIEW_VIEWPORT_MAX_SIZE)) {
                throw new RangeError(`Preview viewport dimensions must be integers from 1 to ${PREVIEW_VIEWPORT_MAX_SIZE}`);
            }
            fixed = value === null ? null : {width: value.width, height: value.height};
            refresh();
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            observer.disconnect();
            cancelAnimationFrame(animation);
            for (const [name, value, priority] of original) {
                if (value) frame.style.setProperty(name, value, priority);
                else frame.style.removeProperty(name);
            }
        },
    };
}
