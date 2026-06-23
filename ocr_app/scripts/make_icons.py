"""生成 PaddleOCRApp 的应用图标（单一来源，可重复执行）。

设计理念：直接点明用途——「OCR」字样被相机取景框框住并扫描识别。
  - 圆角方块 + 翡翠绿对角渐变作为底（呼应 Web 端主色）。
  - 中央醒目的「OCR」三字母——直接告诉用户这是什么工具，辨识度最高。
  - 四角相机取景框 framing 住文字——代表「光学取景 / 识别」动作。
  - 文字下方一条品牌亮绿扫描线（带柔光）——点出「正在识别」的动感。

文字绘制：用系统字体渲染「OCR」，字号按取景框内宽自适应，再按实际墨迹
  bbox 精确居中。找不到任何可用字体时退回 Pillow 内置位图字体，保证出图。

为什么用 Pillow 纯代码绘制而不是 SVG：
  本机 / CI 不保证有 cairosvg / rsvg / inkscape，但 Pillow 是项目既有依赖
  （requirements.txt）。用代码绘制可在任意平台稳定复现同一图标，避免引入
  额外的二进制渲染器依赖。所有几何量按画布尺寸归一化，4x 超采样后再
  LANCZOS 缩小以获得平滑边缘。

产物（输出到 ocr_app/ocr_app/assets/）：
  - logo-1024.png   1024×1024 主图（用于展示 / Web 下载页等）
  - icon.png        512×512（运行时 setWindowIcon 用，跨平台）
  - icon.icns       macOS .app 图标
  - icon.ico        Windows 可执行文件图标

用法（在 ocr_app/ 下，已装好依赖的虚拟环境中）：
    python scripts/make_icons.py
macOS 才能生成 .icns（依赖系统自带 iconutil）；其他平台会自动跳过 .icns。
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image, ImageDraw, ImageFont

# 画布超采样倍率：先在 SCALE 倍尺寸上绘制再缩小，得到抗锯齿边缘。
SCALE = 4

# 翡翠绿对角渐变（左上亮、右下深），通透现代，与 ocr_web 主色调呼应。
GREEN_TL = (52, 211, 153)   # emerald-400
GREEN_BR = (5, 150, 105)    # emerald-600
SCAN = (190, 255, 224)      # 扫描线亮绿（带柔光）

# 中央文字用的字体候选（粗体优先，字形更有分量）。找不到则用内置字体兜底。
FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/Library/Fonts/Arial Bold.ttf",
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/Helvetica.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
]

ASSETS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "ocr_app", "assets")


def _diagonal_gradient(size: int, c0, c1) -> Image.Image:
    """生成左上->右下的对角线性渐变 RGB 图。"""
    c0 = np.array(c0, dtype=np.float32)
    c1 = np.array(c1, dtype=np.float32)
    xs = np.linspace(0.0, 1.0, size, dtype=np.float32)
    gx, gy = np.meshgrid(xs, xs)
    t = ((gx + gy) / 2.0)[..., None]  # (size,size,1)
    arr = (c0 * (1.0 - t) + c1 * t).astype(np.uint8)
    return Image.fromarray(arr, "RGB")


def _load_font(px: int):
    """按候选列表加载一个字体；都不可用时返回 None（走内置字体兜底）。"""
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, px)
            except OSError:
                continue
    return None


def _fit_font(d: ImageDraw.ImageDraw, text: str, target_w: float):
    """返回让 text 渲染宽度约等于 target_w 的字体；无可用字体时返回 None。"""
    probe = _load_font(200)
    if probe is None:
        return None
    bb = d.textbbox((0, 0), text, font=probe)
    w = bb[2] - bb[0]
    if w <= 0:
        return probe
    return _load_font(max(8, int(200 * target_w / w)))


def draw_logo(size: int) -> Image.Image:
    """绘制 size×size 的 RGBA 图标（取景框 + 「OCR」文字 + 扫描线）。"""
    S = size * SCALE
    grad = _diagonal_gradient(S, GREEN_TL, GREEN_BR).convert("RGBA")

    # 圆角方块底（macOS 风格连续圆角，半径约 22.5%）
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.225), fill=255)
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    img.paste(grad, (0, 0), mask)

    d = ImageDraw.Draw(img)
    white = (255, 255, 255, 255)
    soft = (255, 255, 255, 235)  # 取景角略柔和，与主体文字拉开层次

    cx, cy = S * 0.5, S * 0.5

    # —— 相机取景框四角（圆角 L 形，框住文字）——
    m = S * 0.150
    x0, y0, x1, y1 = m, m, S - m, S - m
    seg = (x1 - x0) * 0.20       # 每个角单边长度
    lw = int(S * 0.040)          # 取景角线宽
    r = lw / 2

    def corner(px, py, dx, dy):
        pts = [(px + dx * seg, py), (px, py), (px, py + dy * seg)]
        d.line(pts, fill=soft, width=lw, joint="curve")
        for ex, ey in ((px + dx * seg, py), (px, py + dy * seg), (px, py)):
            d.ellipse([ex - r, ey - r, ex + r, ey + r], fill=soft)

    corner(x0, y0, 1, 1)     # 左上
    corner(x1, y0, -1, 1)    # 右上
    corner(x0, y1, 1, -1)    # 左下
    corner(x1, y1, -1, -1)   # 右下

    # —— 中央「OCR」文字（直接点明用途，OCR 的主体）——
    text = "OCR"
    target_w = (x1 - x0) * 0.86      # 适配取景框内宽，留呼吸边距
    font = _fit_font(d, text, target_w)
    ty_text = cy - (y1 - y0) * 0.045  # 略上移，给下方扫描线留位置
    if font is not None:
        bbox = d.textbbox((0, 0), text, font=font)
        gw, gh = bbox[2] - bbox[0], bbox[3] - bbox[1]
        tx = cx - (bbox[0] + gw / 2)
        ty = ty_text - (bbox[1] + gh / 2)
        d.text((tx, ty), text, font=font, fill=white)
    else:
        # 极端兜底：无任何 TTF 时用内置位图字体，尽量放大居中
        fb = ImageFont.load_default()
        d.text((cx, ty_text), text, font=fb, fill=white, anchor="mm")

    # —— 扫描线：取景框内偏下，细亮绿 + 柔光，点出「正在识别」 ——
    scan_y = y0 + (y1 - y0) * 0.74
    sx0, sx1 = x0 + seg * 0.5, x1 - seg * 0.5
    d.line([(sx0, scan_y), (sx1, scan_y)], fill=SCAN + (70,), width=int(S * 0.050))
    d.line([(sx0, scan_y), (sx1, scan_y)], fill=SCAN + (255,), width=int(S * 0.017))

    return img.resize((size, size), Image.LANCZOS)


def _make_icns(out_path: str) -> bool:
    """用 macOS iconutil 把多尺寸 PNG 合成 .icns。非 macOS 或无 iconutil 时返回 False。"""
    if sys.platform != "darwin" or shutil.which("iconutil") is None:
        return False
    sizes = [16, 32, 128, 256, 512]
    with tempfile.TemporaryDirectory() as tmp:
        iconset = os.path.join(tmp, "icon.iconset")
        os.makedirs(iconset)
        for s in sizes:
            draw_logo(s).save(os.path.join(iconset, f"icon_{s}x{s}.png"))
            draw_logo(s * 2).save(os.path.join(iconset, f"icon_{s}x{s}@2x.png"))
        subprocess.run(["iconutil", "-c", "icns", iconset, "-o", out_path], check=True)
    return True


def main() -> int:
    os.makedirs(ASSETS_DIR, exist_ok=True)

    draw_logo(1024).save(os.path.join(ASSETS_DIR, "logo-1024.png"))
    draw_logo(512).save(os.path.join(ASSETS_DIR, "icon.png"))

    # Windows .ico：内嵌多尺寸，系统按场景选用。
    draw_logo(256).save(
        os.path.join(ASSETS_DIR, "icon.ico"),
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )

    icns_path = os.path.join(ASSETS_DIR, "icon.icns")
    if _make_icns(icns_path):
        print(f"已生成: {icns_path}")
    else:
        print("跳过 .icns（仅 macOS + iconutil 可生成）")

    print(f"图标已输出到: {ASSETS_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
