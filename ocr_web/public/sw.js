/*
 * Service Worker：缓存体积较大的 PaddleJS OCR 模型资源。
 *
 * 背景：@paddlejs-models/ocr 每次 init() 都会从百度 bcebos CDN 下载约 8~10MB 的
 * 模型（det/rec 的 model.json + chunk_*.dat）。该 CDN 不返回 Cache-Control、
 * Expires 仅 3 天，浏览器会反复重新下载或发条件请求校验，导致每次打开页面都很慢。
 *
 * 策略：对模型域名的 GET 请求采用 cache-first —— 命中缓存直接返回（永不再走网络），
 * 未命中才下载并写入 CacheStorage。模型文件内容固定，无需失效。
 * 首次访问后即可秒开，并支持离线使用。
 *
 * 仅接管模型资源，不缓存 HTML/应用脚本，避免发布新版本后命中旧缓存。
 */

const MODEL_CACHE = 'paddle-ocr-model-v1';

// 仅缓存这些来源的资源（PaddleJS 模型与权重所在的百度对象存储）。
const MODEL_HOSTS = ['paddlejs.bj.bcebos.com', 'paddleocr.bj.bcebos.com'];

self.addEventListener('install', () => {
  // 跳过等待，新版本 SW 安装后立即激活。
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 清理旧版本模型缓存（仅清理本 SW 管理的命名空间）。
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('paddle-ocr-model-') && k !== MODEL_CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  // 只接管模型资源，其余请求保持默认（直连网络）。
  if (!MODEL_HOSTS.includes(url.hostname)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(MODEL_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached; // cache-first：命中即返回，不再走网络。

      try {
        const resp = await fetch(req);
        // 只缓存可用响应（CDN 支持 CORS，正常为 200；opaque 兜底也缓存）。
        if (resp && (resp.ok || resp.type === 'opaque')) {
          cache.put(req, resp.clone()).catch(() => {});
        }
        return resp;
      } catch (err) {
        // 网络失败且无缓存时，回退到一个明确的错误响应。
        const fallback = await cache.match(req);
        if (fallback) return fallback;
        throw err;
      }
    })(),
  );
});
