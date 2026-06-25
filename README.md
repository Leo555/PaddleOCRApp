# PaddleOCR 工具集

一款免费、开源的文字识别（OCR）工具，能把**图片和 PDF 里的文字提取成可编辑文本**，支持**中文 / 英文 / 数字**。

提供两种使用形态，能力一致，按需选用：

- 🌐 **网页版**——打开浏览器即用，无需安装
- 💻 **桌面客户端**——macOS / Windows / Linux，可离线使用

> 🔒 **隐私优先**：无论网页版还是客户端，图片与 PDF 都**只在你本机处理，不上传任何服务器**。

## 快速开始

| 入口 | 地址 |
|------|------|
| 🌐 在线使用 | **https://ocr.lz5z.com/** |
| 💻 下载客户端 | **https://ocr.lz5z.com/#/download**（自动识别系统推荐安装包）<br>或前往 [GitHub Releases](https://github.com/Leo555/PaddleOCRApp/releases/latest) 直接下载 |

## 能做什么

- 📷 **多种导入方式**：打开本地图片 / PDF、直接拖拽、粘贴剪贴板截图（客户端还支持框选截图识别）
- 📄 **支持 PDF**：自动逐页渲染，可翻页识别，扫描件 / 图片型 PDF 同样适用
- ✍️ **结果可编辑**：识别文本可直接修改、一键复制，导出 **TXT / JSON**
- 🟩 **检测框可视化**：在原图上叠加文字检测框，识别区域一目了然（可开关）
- 🈶 **中英数混排**：基于百度 [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) 的 PP-OCR 模型，开箱即用

## 如何使用

### 方式一：网页版（最简单）

打开 **https://ocr.lz5z.com/** 即可使用，免安装、免登录。识别在浏览器本地完成，首次打开会自动下载模型（数 MB），之后会被缓存。

> 详见 [`ocr_web/README.md`](ocr_web/README.md)。

### 方式二：桌面客户端（可离线）

前往 **https://ocr.lz5z.com/#/download** 会**自动识别你的系统并推荐对应安装包**，下载后即可运行（也可直接到 [GitHub Releases](https://github.com/Leo555/PaddleOCRApp/releases/latest) 下载）：

| 系统 | 安装包 |
|------|--------|
| macOS（Apple Silicon） | `PaddleOCRApp-macos-arm64.zip` |
| macOS（Intel） | `PaddleOCRApp-macos-x64.zip` |
| Windows | `PaddleOCRApp-windows.zip` |
| Linux | `PaddleOCRApp-linux.tar.gz` |

客户端自带识别模型，**装好后无需联网也能使用**。

> 详见 [`ocr_app/README.md`](ocr_app/README.md)。

## 意见反馈

使用中遇到问题或有功能建议，欢迎通过网页 / 客户端内的「意见反馈」入口，或直接到 [GitHub Issues](https://github.com/Leo555/PaddleOCRApp/issues/new) 反馈。

---

## 面向开发者

本仓库是一个 monorepo，包含两个**独立、自包含**的子项目，各自拥有完整文档：

| 形态 | 目录 | 技术栈 | 推理位置 | 文档 |
|------|------|--------|----------|------|
| 桌面客户端 | [`ocr_app/`](ocr_app) | Python + PySide6 + RapidOCR(ONNX) | 本地 Python 进程 | [ocr_app/README.md](ocr_app/README.md) |
| Web 在线应用 | [`ocr_web/`](ocr_web) | Vite + React + PaddleJS(WebGL) | 用户浏览器内 | [ocr_web/README.md](ocr_web/README.md) |

### 本地运行

```bash
# 桌面客户端：一键创建虚拟环境、安装依赖并启动
bash ocr_app/run.sh

# Web 在线应用
cd ocr_web && npm install && npm run dev
```

### 持续集成与发布

`.github/workflows/` 下的流水线托管到 GitHub 后自动生效：

| 流水线 | 触发 | 作用 |
|--------|------|------|
| `build-app.yml` | 每次 push | 用 PyInstaller 在 macOS(arm64) / Windows / Linux 上打包桌面客户端，上传为 Actions Artifacts |
| `build-app.yml` | push tag `v*` | 额外发布到 **GitHub Releases**，供下载页固定直链使用 |

> **macOS Intel（x64）不走 CI**：GitHub 免费额度下 `macos-13`（Intel）runner 常排不到机器、长时间 queued 并阻塞发布，故 Intel 包改为在 Apple Silicon Mac 上用 x86_64(Rosetta) Python 本地打包后手动上传 Release，步骤见 [`ocr_app/README.md`](ocr_app/README.md)。
