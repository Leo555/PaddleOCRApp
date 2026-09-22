import React from 'react';
import ReactDOM from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    {/* Analytics 上报流量/访问数据，SpeedInsights 上报真实用户性能数据（LCP/FCP/CLS/TTFB）。 */}
    <Analytics />
    <SpeedInsights />
  </React.StrictMode>,
);

// 注册 Service Worker：缓存 PaddleJS 模型资源，避免每次打开都重新下载约 8~10MB。
// 仅生产环境注册，开发环境下不注册以免干扰 Vite 热更新。
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* 注册失败不影响主流程，静默忽略。 */
    });
  });
}
