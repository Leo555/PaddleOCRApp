"""PDF 渲染：把指定页渲染成 QPixmap，供 OCR 流程复用图片处理路径。

后端使用 PyMuPDF(fitz)，纯 wheel 跨平台、无系统依赖。采用「按需渲染单页」
策略：不一次性把整本 PDF 读进内存，翻页时才渲染对应页，对大文档更友好。

加密 PDF：打开后若 ``doc.needs_pass`` 为真，需用 ``authenticate(password)``
解锁。各函数统一接收 ``password`` 参数；缺密码或密码错误时抛
``PdfPasswordRequired``，由调用方决定如何向用户索要密码。
"""
from __future__ import annotations

from PySide6.QtGui import QImage, QPixmap


class PdfError(RuntimeError):
    """PDF 处理相关错误（含依赖缺失、文件损坏等）。"""


class PdfPasswordRequired(PdfError):
    """PDF 已加密且未提供正确密码。

    ``incorrect`` 区分两种情况：False 表示尚未提供密码，True 表示已提供
    但密码错误，便于调用方给出不同的提示文案。
    """

    def __init__(self, incorrect: bool) -> None:
        self.incorrect = incorrect
        super().__init__("PDF 密码错误。" if incorrect else "PDF 已加密，需要密码。")


def _open(path: str, password: str = ""):
    try:
        import fitz  # PyMuPDF
    except ImportError as exc:  # 依赖未安装时给出可读提示
        raise PdfError(
            "未安装 PDF 渲染依赖 PyMuPDF。请先执行：pip install PyMuPDF"
        ) from exc
    try:
        doc = fitz.open(path)
    except Exception as exc:  # noqa: BLE001 - 统一包装成 PdfError
        raise PdfError(f"无法打开 PDF：{exc}") from exc

    # 加密文档需先解锁，否则后续读取页数/渲染都会失败。
    if doc.needs_pass:
        if not password:
            doc.close()
            raise PdfPasswordRequired(False)
        if not doc.authenticate(password):
            doc.close()
            raise PdfPasswordRequired(True)
    return doc


def get_page_count(path: str, password: str = "") -> int:
    """返回 PDF 总页数。"""
    doc = _open(path, password)
    try:
        return doc.page_count
    finally:
        doc.close()


def render_page(path: str, index: int, zoom: float = 2.0, password: str = "") -> QPixmap:
    """把第 ``index`` 页（从 0 开始）渲染成 QPixmap。

    ``zoom`` 为渲染倍率，2.0 约等于 144 DPI，可保证识别清晰度。
    """
    import fitz  # 已在 _open 校验过依赖

    doc = _open(path, password)
    try:
        if index < 0 or index >= doc.page_count:
            raise PdfError(f"页码超出范围：{index + 1}/{doc.page_count}")
        page = doc.load_page(index)
        matrix = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=matrix, alpha=False)
        image = QImage(
            pix.samples, pix.width, pix.height, pix.stride, QImage.Format_RGB888
        )
        # copy() 必须：QImage 仅引用了 pix.samples 的缓冲，doc 关闭后会失效。
        return QPixmap.fromImage(image.copy())
    finally:
        doc.close()
