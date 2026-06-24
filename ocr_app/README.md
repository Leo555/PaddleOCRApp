# 桌面 OCR 客户端（PySide6）

基于 [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) 的 PP-OCR 模型构建的跨平台桌面 OCR 工具，使用 PySide6 原生 GUI，本地 Python 进程推理。

> 这是 OCR 仓库的「桌面形态」。仓库同时包含一个纯浏览器端的 Web 在线应用（见同级目录 [`../ocr_web/`](../ocr_web/README.md)），两者各自独立、自包含。

## 关于推理后端

本项目使用 [RapidOCR](https://github.com/RapidAI/RapidOCR) 作为推理后端。RapidOCR 运行的正是 **PaddleOCR 的 PP-OCR 检测 / 方向分类 / 识别模型转成的 ONNX 版本**，通过 ONNX Runtime 推理。

之所以不直接用 `paddlepaddle`：在 macOS（尤其 Apple Silicon + x86_64 Rosetta）环境下，paddlepaddle 仅有 3.0.0 的 x86_64 wheel 且无法运行当前 PP-OCR 模型（PIR 推理器报 int64 strides 错误），paddle2onnx 的 wheel 也存在架构不匹配问题。RapidOCR 自带模型、跨平台稳定、可离线使用，是在本机能真正跑通的等价方案。详见 `ocr_app/engine.py` 顶部说明。

## 功能

- 多种输入方式：**打开图片 / PDF** / **拖拽图片或 PDF** / **粘贴剪贴板截图** / **截图识别**
- 支持 **PDF**：自动逐页渲染，工具栏可翻页（◀ / ▶），识别当前页
- 一键识别，结果文本可编辑、可一键复制，支持**导出 TXT / JSON**
- 在原图上叠加绘制**检测框**，可视化识别区域（可开关）
- 默认模型同时覆盖**中文 + 英文 + 数字**（PP-OCRv4 中文模型）
- 模型加载与识别均在**后台线程**执行，界面不卡顿

## 环境要求

- Python 3.8 ~ 3.12（推荐 3.11）
- macOS / Windows / Linux（CPU 即可运行，自带模型）

## 快速开始

```bash
# 一键安装 + 运行（在本目录或仓库根目录均可）
bash run.sh
```

脚本会在当前 `ocr_app/` 下自动创建 `.venv` 虚拟环境、安装依赖并启动。

> 首次安装会下载依赖；OCR 模型已随 `rapidocr-onnxruntime` 一并打包，**无需联网下载模型，可离线使用**。

### 手动方式

```bash
cd ocr_app
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m ocr_app
```

### 冒烟测试（无界面）

```bash
python smoke_test.py
```

## 打包为可分发客户端

使用 [PyInstaller](https://pyinstaller.org/) 打包（已提供 `ocr_app.spec`，会自动收集 RapidOCR 的 ONNX 模型与 onnxruntime/PyMuPDF 原生库）：

```bash
cd ocr_app
source .venv/bin/activate          # 或先按上文创建虚拟环境
pip install pyinstaller
pyinstaller ocr_app.spec --noconfirm
```

产物在 `ocr_app/dist/` 下：

- **macOS**：`dist/PaddleOCRApp.app`
- **Windows / Linux**：`dist/PaddleOCRApp/` 目录（运行其中的 `PaddleOCRApp` 可执行文件）

> 多平台安装包由 CI 自动构建：在 macOS(arm64) / Windows / Linux 上打包并上传为 GitHub Actions Artifacts；打 tag（`v*`）时发布到 GitHub Releases。详见仓库根 README 的「持续集成与发布」一节，以及 `.github/workflows/build-app.yml`。
> 资产命名（如 `PaddleOCRApp-macos-arm64.zip`）与 Web 下载页 `ocr_web/src/Download.tsx` 中的常量一一对应，**改名需同步两处**。

### macOS Intel（x64）：本地打包后手动上传 Release

Intel 包不在 CI 内构建（`macos-13` runner 常排不到机器、长时间 queued 会阻塞发布）。在 **Apple Silicon Mac** 上即可打出真正的 x64 包——只要用一个 **x86_64（Rosetta）的 Python** 来跑 PyInstaller（PyInstaller 产出的架构 = 运行它的 Python 架构）：

```bash
cd ocr_app

# 0) 准备 Rosetta（仅首次）：
softwareupdate --install-rosetta --agree-to-license

# 1) 用 x86_64 的 Python 创建 venv（确认 venv 架构为 x86_64）：
#    若已有 x86_64 的 .venv 可直接复用；验证：
#    .venv/bin/python -c "import platform;print(platform.machine())"  # 应输出 x86_64
arch -x86_64 /path/to/x86_64/python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt pyinstaller

# 2) 打包并核对架构（应为 x86_64）：
pyinstaller ocr_app.spec --noconfirm
lipo -archs dist/PaddleOCRApp.app/Contents/MacOS/PaddleOCRApp

# 3) 压成与下载页约定一致的资产名：
cd dist && zip -ry "../../PaddleOCRApp-macos-x64.zip" "PaddleOCRApp.app" && cd ..

# 4) 上传到对应 tag 的 Release（需已登录 gh）：
gh release upload v0.1.1 ../PaddleOCRApp-macos-x64.zip --clobber
```

> 产物 `PaddleOCRApp-macos-x64.zip` 须与 `ocr_web/src/Download.tsx` 的 macOS · Intel 卡片资产名一致。

## 项目结构

```
ocr_app/
├── README.md
├── ocr_app/                # Python 包
│   ├── __main__.py         # 入口（python -m ocr_app）
│   ├── assets/             # 应用图标（icon.png / icon.icns / icon.ico / logo-1024.png）
│   ├── engine.py           # OCR 引擎封装：懒加载 / 结果解析（后端 RapidOCR）
│   ├── worker.py           # QThread 后台 worker（预热 + 识别）
│   ├── image_view.py       # 图片显示控件：拖拽 / 缩放 / 检测框叠加
│   ├── pdf_loader.py       # PDF 按需逐页渲染成位图（后端 PyMuPDF）
│   ├── screen_capture.py   # 全屏框选截图
│   └── main_window.py      # 主窗口 GUI
├── launcher.py             # PyInstaller 打包入口（绝对导入调用 main）
├── ocr_app.spec            # PyInstaller 打包配置
├── scripts/
│   └── make_icons.py       # 用 Pillow 生成应用图标（单一来源）
├── smoke_test.py           # 无界面冒烟测试
├── requirements.txt
└── run.sh
```

## 使用提示

1. 启动后状态栏显示「正在后台加载 OCR 模型」，加载完成后「开始识别」按钮可用。
2. 载入图片后点击「开始识别」，结果会显示在右侧文本框，原图上叠加绿色检测框。
3. 如需扩展更多语言（日 / 韩 / 繁中等），可在 `engine.py` 中为 RapidOCR 指定对应语言的 ONNX 识别模型。
