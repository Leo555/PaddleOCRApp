# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller 打包配置：PaddleOCRApp 桌面客户端。

打包要点：
- RapidOCR(onnxruntime) 自带 PP-OCR 的 ONNX 模型与配置（yaml），属于运行期必需的
  数据文件 + 动态库，必须用 collect_all 完整收集，否则打包后找不到模型/算子。
- PyMuPDF(fitz) 含原生扩展，一并收集。
- PySide6 由 PyInstaller 内置 hook 处理，无需手动收集（避免把整个 Qt 全量打入）。
- 采用 onedir（COLLECT）模式：启动快、对 onnxruntime 动态库友好；macOS 额外产出 .app。

用法（在 ocr_app/ 目录下）：
    pyinstaller ocr_app.spec --noconfirm
产物在 ocr_app/dist/ 下：
    - macOS:        dist/PaddleOCRApp.app（同时有 dist/PaddleOCRApp/ 目录）
    - Windows/Linux: dist/PaddleOCRApp/ 目录
"""
from PyInstaller.utils.hooks import collect_all

datas = []
binaries = []
hiddenimports = ["fitz"]

# RapidOCR 的模型/配置/onnxruntime 动态库必须完整收集。
for pkg in ("rapidocr_onnxruntime", "onnxruntime"):
    d, b, h = collect_all(pkg)
    datas += d
    binaries += b
    hiddenimports += h

a = Analysis(
    ["launcher.py"],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="PaddleOCRApp",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,  # GUI 应用，不弹控制台
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="PaddleOCRApp",
)

# 仅 macOS 生效；Windows/Linux 下 PyInstaller 会忽略 BUNDLE。
app = BUNDLE(
    coll,
    name="PaddleOCRApp.app",
    icon=None,
    bundle_identifier="com.ocr.paddleocrapp",
    info_plist={
        "CFBundleName": "PaddleOCRApp",
        "CFBundleDisplayName": "PaddleOCRApp",
        "NSHighResolutionCapable": True,
    },
)
