"""截图取词：全屏覆盖 + 鼠标框选，截取所选区域的屏幕图像。

实现要点：
- 进入时抓取「鼠标所在屏幕」的整屏截图（grabWindow），作为冻结背景，
  避免实时屏幕变化导致框选错位；
- 全屏半透明遮罩，框选区域高亮显示原始画面；
- 正确处理 Retina 高分屏的 devicePixelRatio（widget 逻辑像素 -> 截图物理像素）；
- 松开鼠标返回裁剪后的 QPixmap；Esc 取消。

注意（macOS）：首次抓屏会触发系统「屏幕录制」权限申请，
需要在「系统设置 → 隐私与安全性 → 屏幕录制」中授权后重启应用。
"""
from __future__ import annotations

from typing import Optional

from PySide6.QtCore import QPoint, QRect, Qt, Signal
from PySide6.QtGui import (
    QColor,
    QCursor,
    QGuiApplication,
    QPainter,
    QPen,
    QPixmap,
)
from PySide6.QtWidgets import QWidget


class ScreenCaptureOverlay(QWidget):
    """全屏框选截图覆盖层。"""

    captured = Signal(QPixmap)  # 框选完成，返回裁剪图像
    cancelled = Signal()        # 用户取消（Esc 或选区过小）

    def __init__(self) -> None:
        super().__init__()
        screen = QGuiApplication.screenAt(QCursor.pos()) or QGuiApplication.primaryScreen()
        self._screen = screen
        geo = screen.geometry()

        # 冻结当前屏幕画面（物理像素，自带 devicePixelRatio）
        self._full: QPixmap = screen.grabWindow(0)

        self.setWindowFlags(
            Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.Tool
        )
        self.setGeometry(geo)
        self.setCursor(Qt.CrossCursor)

        self._origin: Optional[QPoint] = None
        self._current: Optional[QPoint] = None

    # ---------------------------------------------------------------- #
    def _selection_rect(self) -> QRect:
        if self._origin is None or self._current is None:
            return QRect()
        return QRect(self._origin, self._current).normalized()

    def _crop(self, sel: QRect) -> QPixmap:
        """把逻辑像素选区映射到截图物理像素并裁剪。"""
        dpr = self._full.devicePixelRatio()
        src = QRect(
            int(round(sel.x() * dpr)),
            int(round(sel.y() * dpr)),
            int(round(sel.width() * dpr)),
            int(round(sel.height() * dpr)),
        )
        cropped = self._full.copy(src)
        cropped.setDevicePixelRatio(1.0)
        return cropped

    # ---------------------------------------------------------------- #
    def paintEvent(self, event) -> None:  # noqa: N802
        painter = QPainter(self)
        # 画冻结的整屏画面（自动按 dpr 缩放到逻辑像素铺满）
        painter.drawPixmap(self.rect(), self._full)

        mask = QColor(0, 0, 0, 130)
        sel = self._selection_rect()
        if sel.isValid() and sel.width() > 0 and sel.height() > 0:
            # 上下左右四块遮罩，选区保持原画面清晰
            full = self.rect()
            painter.fillRect(QRect(full.left(), full.top(), full.width(), sel.top()), mask)
            painter.fillRect(
                QRect(full.left(), sel.bottom() + 1, full.width(), full.bottom() - sel.bottom()),
                mask,
            )
            painter.fillRect(QRect(full.left(), sel.top(), sel.left(), sel.height()), mask)
            painter.fillRect(
                QRect(sel.right() + 1, sel.top(), full.right() - sel.right(), sel.height()),
                mask,
            )

            pen = QPen(QColor("#3fb950"))
            pen.setWidth(2)
            painter.setPen(pen)
            painter.drawRect(sel)

            # 尺寸提示
            painter.setPen(QColor("#ffffff"))
            painter.drawText(
                sel.left(),
                max(sel.top() - 6, 12),
                f"{sel.width()} × {sel.height()}",
            )
        else:
            painter.fillRect(self.rect(), mask)
            painter.setPen(QColor("#e6e6e6"))
            painter.drawText(
                self.rect(),
                Qt.AlignCenter,
                "拖拽框选要识别的区域　·　Esc 取消",
            )

    # ---------------------------------------------------------------- #
    def mousePressEvent(self, event) -> None:  # noqa: N802
        if event.button() == Qt.LeftButton:
            self._origin = event.position().toPoint()
            self._current = self._origin
            self.update()

    def mouseMoveEvent(self, event) -> None:  # noqa: N802
        if self._origin is not None:
            self._current = event.position().toPoint()
            self.update()

    def mouseReleaseEvent(self, event) -> None:  # noqa: N802
        if event.button() != Qt.LeftButton or self._origin is None:
            return
        sel = self._selection_rect()
        self.close()
        if sel.width() > 3 and sel.height() > 3:
            self.captured.emit(self._crop(sel))
        else:
            self.cancelled.emit()

    def keyPressEvent(self, event) -> None:  # noqa: N802
        if event.key() == Qt.Key_Escape:
            self.close()
            self.cancelled.emit()
