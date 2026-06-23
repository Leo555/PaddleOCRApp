# 在线 OCR（Web 端）

纯浏览器端的 PaddleOCR 在线文字识别。基于 [`@paddlejs-models/ocr`](https://www.npmjs.com/package/@paddlejs-models/ocr)（PaddleOCR 的 PP-OCR 检测 + 识别模型，PaddleJS WebGL 推理），**识别全程在用户浏览器本地完成，图片不上传任何服务器**，因此可作为纯静态站点部署到 Vercel。

> 这是 OCR 仓库的「Web 形态」。仓库同时包含一个 Python + PySide6 的桌面客户端（见上级目录 `ocr_app/`），两者各自独立。

## 功能

- 输入方式：**打开图片 / PDF** / **拖拽图片或 PDF** / **Ctrl·⌘+V 粘贴图片**
- 支持 **PDF**：用 `pdf.js` 在前端逐页渲染成位图，多页时工具栏下方可翻页，切页自动识别该页
- 一键识别，支持**中文 + 英文 + 数字**（PP-OCRv2 检测 + 识别模型）
- 在画布上叠加**检测框**（可开关）
- 结果文本可编辑、可**复制**、可**导出 TXT / JSON**
- 模型与推理均在浏览器内运行，**零后端、可离线（首次需联网下载模型）**
- 内置**桌面客户端下载页**（`/#/download`）：按访问者系统自动推荐对应平台安装包

## 客户端下载页

工具栏「下载客户端」进入 `/#/download`，页面会探测访问者操作系统并高亮推荐对应的桌面客户端安装包，同时列出全部平台（macOS Apple Silicon / Windows / Linux）。

下载链接指向 GitHub Releases 的最新版本固定直链，因此需配置仓库 slug：

```bash
# 本地开发可在 ocr_web/.env.local 写入；Vercel 在项目 Environment Variables 配置
VITE_GITHUB_REPO=你的/仓库     # 例如 your-org/ocr
```

未配置时下载页会提示且按钮置灰。安装包由 CI（`.github/workflows/build-app.yml`）多平台构建并在打 tag 时发布到 Releases，资产名与 `src/Download.tsx` 中的常量一一对应。

## 本地开发

```bash
cd ocr_web
npm install
npm run dev      # http://localhost:5173
```

```bash
npm run build    # 产物输出到 dist
npm run preview  # 本地预览生产构建
```

## 部署到 Vercel

> 仓库已配置 GitHub Actions（`.github/workflows/deploy-web.yml`）：push 到 `main`/`master` 且涉及 `ocr_web/` 变更时会**自动部署到 Vercel 生产环境**。需在仓库 Secrets 配置 `VERCEL_TOKEN` / `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID`，详见根 README。以下为手动/初次接入方式。

本目录已自带 `vercel.json`（framework=vite，输出 `dist`）。两种方式：

**方式一：Dashboard（推荐）**
1. 在 Vercel 新建 Project，导入本仓库。
2. **Root Directory 设为 `ocr_web`**（关键，因为仓库是 monorepo）。
3. Framework 选 *Vite*，Build Command `npm run build`，Output Directory `dist`（通常自动识别）。
4. Deploy。

**方式二：CLI**
```bash
cd ocr_web
npx vercel --prod
```

## 说明与限制

- **首屏需联网**：PP-OCR 模型由 PaddleJS 官方 CDN 加载，首次打开会下载模型（数 MB），之后浏览器会缓存。
- **性能**：依赖 WebGL，桌面浏览器流畅；移动端或无独显设备识别较慢。大图与 PDF 页在识别前会下采样到最长边 2048px，兼顾速度与清晰度（检测框坐标按比例还原回原图）。
- **隐私**：图片与 PDF 仅在本地处理，不经过任何服务器。
- **PDF**：走「逐页栅格化 + OCR」路线，对扫描件/图片型 PDF 是必需方式；纯文字 PDF 也能识别，如需直接抽取原生文本层（更快更准）可后续加 `getTextContent()` 旁路。粘贴目前仅支持图片，PDF 通过打开/拖拽导入。
