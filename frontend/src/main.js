import { createApp } from 'vue';
import App from './App.vue';
import router from './router/index.js';
import { i18n } from './i18n/index.js';
import { installDemoApi } from './shared/demo-api.js';
import './style.css';

if (import.meta.env.VITE_DEMO_MODE === 'true') installDemoApi();

window.__APP_ROUTER__ = router;

createApp(App).use(i18n).use(router).mount('#app');
