"""冒烟测试：生成一张含文字的图片并跑通 OCR 引擎（无 GUI）。"""
import os
import tempfile

from PIL import Image, ImageDraw

from ocr_app.engine import OcrEngine


def make_test_image(path: str) -> None:
    img = Image.new("RGB", (640, 200), "white")
    draw = ImageDraw.Draw(img)
    # 用默认字体绘制英文（默认字体不含中文字形，故用英文确保可读）
    draw.text((30, 60), "Hello PaddleOCR 12345", fill="black")
    draw.text((30, 120), "Desktop OCR Tool", fill="black")
    img.save(path)


def main() -> None:
    tmp = os.path.join(tempfile.gettempdir(), "ocr_smoke.png")
    make_test_image(tmp)
    print(f"测试图片: {tmp}")

    engine = OcrEngine(lang="ch")
    print("加载模型并识别中（首次会下载模型）…")
    result = engine.recognize(tmp)

    print(f"\n识别耗时: {result.elapsed:.2f}s, 行数: {len(result.lines)}")
    for i, line in enumerate(result.lines):
        print(f"  [{i}] score={line.score:.3f}  text={line.text!r}  box_pts={len(line.box)}")

    assert result.lines, "未识别到任何文本，解析逻辑可能有问题"
    print("\n✅ 引擎冒烟测试通过")


if __name__ == "__main__":
    main()
