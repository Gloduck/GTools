import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(() => {
  const backendProxyTarget = process.env.VITE_BACKEND_PROXY_TARGET;

  return {
    base: process.env.VITE_BASE_PATH || '/',
    plugins: [
      vue(),
      viteStaticCopy({
        targets: [
          {
            src: 'node_modules/monaco-editor/min/vs',
            dest: 'vendor/monaco/0.55.1'
          },
          {
            src: 'node_modules/vditor/dist',
            dest: 'vendor/vditor/3.11.2'
          }
        ]
      })
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        vue: 'vue/dist/vue.esm-bundler.js'
      }
    },
    server: backendProxyTarget ? {
      proxy: {
        '/api': {
          target: backendProxyTarget,
          changeOrigin: true,
          ws: true,
          secure: false
        }
      }
    } : undefined
  };
});
