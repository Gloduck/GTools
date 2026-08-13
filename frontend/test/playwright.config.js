import {defineConfig, devices} from '@playwright/test';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const baseURL = 'http://127.0.0.1:4174';
const outputDir = process.env.PLAYWRIGHT_OUTPUT_DIR || join(tmpdir(), 'gtools-playwright-results');

export default defineConfig({
    testDir: './unit',
    testMatch: '**/*.spec.js',
    fullyParallel: false,
    workers: 1,
    timeout: 30_000,
    expect: {timeout: 5_000},
    reporter: 'line',
    outputDir,
    preserveOutput: 'failures-only',
    use: {
        baseURL,
        headless: true,
        trace: 'retain-on-failure',
    },
    projects: [{name: 'chromium', use: {...devices['Desktop Chrome']}}],
    webServer: {
        command: 'npm --prefix .. run dev -- --host 127.0.0.1 --port 4174 --strictPort',
        url: `${baseURL}/test/runtime-harness.html`,
        reuseExistingServer: false,
        timeout: 120_000,
    },
});
