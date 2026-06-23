# PaddleOCR 工具集

基于 [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) 的 PP-OCR 模型构建的 OCR 工具集（中文 / 英文 / 数字）。本仓库是一个 monorepo，包含两种形态，分别是两个**独立、自包含**的子项目，各自拥有独立的 README：

| 形态 | 目录 | 技术栈 | 推理位置 | 适用场景 | 文档 |
|------|------|--------|----------|----------|------|
| **桌面客户端** | [`ocr_app/`](ocr_app) | Python + PySide6 + RapidOCR(ONNX) | 本地 Python 进程 | 本机离线、截图取词、PDF | [ocr_app/README.md](ocr_app/README.md) |
| **Web 在线应用** | [`ocr_web/`](ocr_web) | Vite + React + PaddleJS(WebGL) | **用户浏览器内** | 纯前端、零后端、可部署 Vercel | [ocr_web/README.md](ocr_web/README.md) |

两端共享同一套 PP-OCR 模型能力。Web 端推理完全在浏览器本地完成，图片不上传服务器，部署只需托管静态文件。

## 快速开始

**桌面客户端**（详见 [`ocr_app/README.md`](ocr_app/README.md)）：

```bash
bash ocr_app/run.sh   # 一键创建虚拟环境、安装依赖并启动
```

**Web 在线应用**（详见 [`ocr_web/README.md`](ocr_web/README.md)）：

```bash
cd ocr_web && npm install && npm run dev
```

## 项目结构

```
ocr/
├── README.md               # 仓库总览（本文件）
├── .github/workflows/      # CI/CD 流水线
│   ├── deploy-web.yml      # push 主分支 → 自动部署 ocr_web 到 Vercel
│   └── build-app.yml       # 每次 push → 多平台打包 ocr_app；打 tag → 发布 Release
├── ocr_app/                # 桌面客户端子项目（Python + PySide6）
│   └── README.md           # 桌面端独立文档
└── ocr_web/                # Web 在线应用子项目（Vite + React + PaddleJS）
    └── README.md           # Web 端独立文档
```

各子项目的功能说明、环境要求、安装运行、部署方式与注意事项，请参阅对应目录下的 README。

## 持续集成与发布（CI/CD）

仓库托管到 GitHub 后，`.github/workflows/` 下的流水线自动生效：

| 流水线 | 触发 | 作用 |
|--------|------|------|
| `deploy-web.yml` | push 到 `main`/`master`（含 `ocr_web/` 变更） | 用 Vercel CLI 自动构建并部署 Web 端到生产环境 |
| `build-app.yml` | 每次 push | 用 PyInstaller 在 macOS(arm64/x64) / Windows / Linux 上打包桌面客户端，产物作为 Actions Artifacts 上传（可下载） |
| `build-app.yml` | push tag `v*` | 在上一步基础上额外发布到 **GitHub Releases**，供 Web 下载页的固定直链直接下载 |

**首次需配置：**

1. **Vercel 部署** — 在仓库 `Settings → Secrets and variables → Actions` 添加：
   `VERCEL_TOKEN`、`VERCEL_ORG_ID`、`VERCEL_PROJECT_ID`（后两者可在 `ocr_web` 下执行 `npx vercel link` 后于 `.vercel/project.json` 获得）。Vercel 项目的 **Root Directory 须设为 `ocr_web`**。
2. **下载页链接** — 给 Web 端配置环境变量 `VITE_GITHUB_REPO=你的/仓库`（Vercel 项目 Environment Variables 中添加），下载页才能拼出 Release 直链。
3. **发布正式版** — 打 tag 触发 Release：`git tag v0.1.0 && git push --tags`。日常 push 的产物只在 Actions 页可下载（需登录 GitHub），下载页面向公网用户的链接指向 Release。

> Web 端「下载客户端」页（`/#/download`）会根据访问者系统自动推荐对应平台的安装包，详见 [`ocr_web/README.md`](ocr_web/README.md)。
