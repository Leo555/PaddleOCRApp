import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 纯前端静态站点。paddlejs 在浏览器端用 WebGL 推理，模型从官方 CDN 加载。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
  },
});
