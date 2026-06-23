"""图片显示控件：支持拖拽载入、自适应缩放、叠加绘制 OCR 检测框。"""
from __future__ import annotations

from typing import List, Optional

from PySide6.QtCore import QPointF, QRectF, Qt, Signal
from PySide6.QtGui import (
    QColor,
    QDragEnterEvent,
    QDropEvent,
    QPainter,
    QPen,
    QPixmap,
    QPolygonF,
)
from PySide6.QtWidgets import QWidget

from .engine import OcrLine

IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".bmp", ".webp", ".tiff", ".tif", ".gif")
ACCEPT_EXTS = IMAGE_EXTS + (".pdf",)


class ImageView(QWidget):
    """显示图片并在其上叠加检测框。"""

    image_dropped = Signal(str)  # 拖入文件路径

    def __init__(self, parent: Optional[QWidget] = None) -> None:
        super().__init__(parent)
        self.setAcceptDrops(True)
        self.setMinimumSize(320, 320)
        self._pixmap: Optional[QPixmap] = None
        self._lines: List[OcrLine] = []
        self._show_boxes = True
        self.setStyleSheet("background:#1e1f22;")

    # ---------------------------------------------------------------- #
    def set_pixmap(self, pixmap: Optional[QPixmap]) -> None:
        self._pixmap = pixmap
        self._lines = []
        self.update()

    def set_lines(self, lines: List[OcrLine]) -> None:
        self._lines = lines or []
        self.update()

    def set_show_boxes(self, show: bool) -> None:
        self._show_boxes = show
        self.update()

    def has_image(self) -> bool:
        return self._pixmap is not None and not self._pixmap.isNull()

    # ---------------------------------------------------------------- #
    def _target_rect(self) -> QRectF:
        """计算图片等比缩放后在控件中的绘制区域。"""
        if not self.has_image():
            return QRectF()
        pw, ph = self._pixmap.width(), self._pixmap.height()
        ww, wh = self.width(), self.height()
        if pw == 0 or ph == 0:
            return QRectF()
        scale = min(ww / pw, wh / ph)
        dw, dh = pw * scale, ph * scale
        x = (ww - dw) / 2
        y = (wh - dh) / 2
        return QRectF(x, y, dw, dh)

    def paintEvent(self, event) -> None:  # noqa: N802
        painter = QPainter(self)
        painter.fillRect(self.rect(), QColor("#1e1f22"))

        if not self.has_image():
            painter.setPen(QColor("#8a8f98"))
            painter.drawText(
                self.rect(),
                Qt.AlignCenter,
                "拖拽图片或 PDF 到此处\n或点击「打开文件 / 粘贴截图」",
            )
            return

        target = self._target_rect()
        painter.setRenderHint(QPainter.SmoothPixmapTransform)
        painter.drawPixmap(target, self._pixmap, QRectF(self._pixmap.rect()))

        if self._show_boxes and self._lines:
            self._draw_boxes(painter, target)

    def _draw_boxes(self, painter: QPainter, target: QRectF) -> None:
        pw, ph = self._pixmap.width(), self._pixmap.height()
        if pw == 0 or ph == 0:
            return
        sx = target.width() / pw
        sy = target.height() / ph

        pen = QPen(QColor("#3fb950"))
        pen.setWidthF(1.5)
        painter.setPen(pen)
        fill = QColor(63, 185, 80, 40)
        painter.setBrush(fill)

        for line in self._lines:
            if not line.box:
                continue
            poly = QPolygonF(
                [QPointF(target.x() + px * sx, target.y() + py * sy) for px, py in line.box]
            )
            painter.drawPolygon(poly)

    # ---------------------------------------------------------------- #
    def dragEnterEvent(self, event: QDragEnterEvent) -> None:  # noqa: N802
        if event.mimeData().hasUrls():
            for url in event.mimeData().urls():
                if url.toLocalFile().lower().endswith(ACCEPT_EXTS):
                    event.acceptProposedAction()
                    return
        event.ignore()

    def dropEvent(self, event: QDropEvent) -> None:  # noqa: N802
        for url in event.mimeData().urls():
            path = url.toLocalFile()
            if path.lower().endswith(ACCEPT_EXTS):
                self.image_dropped.emit(path)
                event.acceptProposedAction()
                return
        event.ignore()
