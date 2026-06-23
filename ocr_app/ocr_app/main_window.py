"""主窗口：工具栏 + 图片视图 + 结果文本区。"""
from __future__ import annotations

import json
import os
import tempfile
from typing import Optional

from PySide6.QtCore import QEvent, Qt, QTimer
from PySide6.QtGui import QGuiApplication, QKeySequence, QPixmap, QShortcut
from PySide6.QtWidgets import (
    QApplication,
    QCheckBox,
    QFileDialog,
    QHBoxLayout,
    QInputDialog,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMessageBox,
    QPlainTextEdit,
    QPushButton,
    QSpinBox,
    QSplitter,
    QVBoxLayout,
    QWidget,
)

from . import pdf_loader
from .engine import OcrEngine, OcrResult
from .image_view import ImageView
from .screen_capture import ScreenCaptureOverlay
from .worker import OcrWorker, WarmupWorker


class MainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("PaddleOCRApp")
        self.resize(1100, 720)

        self.engine = OcrEngine(lang="ch")
        self._current_image_path: Optional[str] = None
        self._temp_files: list[str] = []
        self._last_result: Optional[OcrResult] = None
        self._ocr_worker: Optional[OcrWorker] = None
        self._warmup_worker: Optional[WarmupWorker] = None
        self._overlay: Optional[ScreenCaptureOverlay] = None
        self._auto_ocr_after_load = False

        # PDF 状态：当前 PDF 路径、总页数、当前页（从 0 开始）、解锁密码
        self._pdf_path: Optional[str] = None
        self._pdf_page_count = 0
        self._pdf_index = 0
        self._pdf_password = ""

        self._build_ui()
        self._build_shortcuts()
        self._start_warmup()

    # ---------------------------------------------------------------- #
    def _build_ui(self) -> None:
        central = QWidget()
        self.setCentralWidget(central)
        root = QVBoxLayout(central)
        root.setContentsMargins(10, 10, 10, 10)
        root.setSpacing(8)

        # 工具栏
        toolbar = QHBoxLayout()
        toolbar.setSpacing(8)

        self.btn_open = QPushButton("打开文件")
        self.btn_open.setToolTip("打开本地图片或 PDF（⌘O）")
        self.btn_paste = QPushButton("粘贴图片")
        self.btn_paste.setToolTip("粘贴剪贴板里的图片（⌘V）")
        self.btn_capture = QPushButton("截图识别")
        self.btn_capture.setToolTip("框选屏幕区域并自动识别（⌘⇧A）")
        self.btn_ocr = QPushButton("开始识别")
        self.btn_ocr.setObjectName("primary")
        self.btn_ocr.setToolTip("识别当前图片（⌘R）")

        self.chk_boxes = QCheckBox("显示检测框")
        self.chk_boxes.setChecked(True)

        # PDF 翻页导航（仅打开 PDF 时显示）
        self.btn_prev = QPushButton("◀")
        self.btn_prev.setToolTip("上一页")
        self.btn_next = QPushButton("▶")
        self.btn_next.setToolTip("下一页")
        # 页码输入框：直接输入页码后回车即可跳转到指定页
        self.spin_page = QSpinBox()
        self.spin_page.setMinimum(1)
        self.spin_page.setMaximum(1)
        self.spin_page.setFixedWidth(56)
        self.spin_page.setAlignment(Qt.AlignCenter)
        # 隐藏右侧上下步进箭头，仅保留可输入页码 + ◀▶ 翻页。
        self.spin_page.setButtonSymbols(QSpinBox.NoButtons)
        self.spin_page.setToolTip("输入页码后回车跳转")
        self.lbl_page_total = QLabel("/ 1")
        for w in (self.btn_prev, self.spin_page, self.lbl_page_total, self.btn_next):
            w.setVisible(False)

        toolbar.addWidget(self.btn_open)
        toolbar.addWidget(self.btn_paste)
        toolbar.addWidget(self.btn_capture)
        toolbar.addWidget(self.btn_ocr)
        toolbar.addSpacing(16)
        toolbar.addWidget(self.btn_prev)
        toolbar.addWidget(self.spin_page)
        toolbar.addWidget(self.lbl_page_total)
        toolbar.addWidget(self.btn_next)
        toolbar.addSpacing(16)
        toolbar.addWidget(self.chk_boxes)
        toolbar.addStretch(1)
        root.addLayout(toolbar)

        # 主区域：左图右文
        splitter = QSplitter(Qt.Horizontal)
        self.image_view = ImageView()
        splitter.addWidget(self.image_view)

        right = QWidget()
        right_layout = QVBoxLayout(right)
        right_layout.setContentsMargins(0, 0, 0, 0)
        right_layout.setSpacing(6)

        result_bar = QHBoxLayout()
        result_bar.addWidget(QLabel("识别结果"))
        result_bar.addStretch(1)
        self.btn_copy = QPushButton("复制全部")
        self.btn_copy.setToolTip("复制结果文本（⌘C 在文本框聚焦时为复制选中）")
        self.btn_export = QPushButton("导出")
        self.btn_export.setToolTip("导出为 TXT / JSON（⌘S）")
        self.btn_clear = QPushButton("清空")
        result_bar.addWidget(self.btn_copy)
        result_bar.addWidget(self.btn_export)
        result_bar.addWidget(self.btn_clear)
        right_layout.addLayout(result_bar)

        self.text_edit = QPlainTextEdit()
        self.text_edit.setPlaceholderText("识别结果将显示在这里…")
        right_layout.addWidget(self.text_edit)

        splitter.addWidget(right)
        splitter.setStretchFactor(0, 3)
        splitter.setStretchFactor(1, 2)
        root.addWidget(splitter, 1)

        self.status = self.statusBar()
        self.status.showMessage("正在后台加载 OCR 模型…")

        # 信号
        self.btn_open.clicked.connect(self.on_open)
        self.btn_paste.clicked.connect(self.on_paste)
        self.btn_capture.clicked.connect(self.on_capture)
        self.btn_ocr.clicked.connect(self.on_ocr)
        self.btn_prev.clicked.connect(self.on_prev_page)
        self.btn_next.clicked.connect(self.on_next_page)
        self.spin_page.editingFinished.connect(self.on_jump_page)
        self.btn_copy.clicked.connect(self.on_copy)
        self.btn_export.clicked.connect(self.on_export)
        self.btn_clear.clicked.connect(self.on_clear)
        self.chk_boxes.toggled.connect(self.image_view.set_show_boxes)
        self.image_view.image_dropped.connect(self.load_path)

        self._apply_style()

    def _build_shortcuts(self) -> None:
        """全局快捷键。"""
        def bind(seq, slot) -> None:
            sc = QShortcut(QKeySequence(seq), self)
            sc.activated.connect(slot)

        # 注意：⌘V 不用 QShortcut 绑定。QShortcut 默认 WindowShortcut，当焦点在
        # 可编辑控件（结果文本框 / 页码输入框）上时，⌘V 会被该控件的"粘贴文本"
        # 动作抢先消费，导致 on_paste 永远不触发。改用应用级事件过滤器统一处理。
        bind(QKeySequence.Open, self.on_open)     # ⌘O 打开
        bind(QKeySequence.Save, self.on_export)   # ⌘S 导出
        bind("Ctrl+R", self.on_ocr)               # ⌘R 识别
        bind("Ctrl+Shift+A", self.on_capture)     # ⌘⇧A 截图识别

        # 应用级事件过滤器：在任意焦点下捕获 ⌘V。剪贴板里是图片/图片文件时拦截
        # 并走 on_paste；否则放行，保留文本框正常粘贴文本的能力。
        app = QApplication.instance()
        if app is not None:
            app.installEventFilter(self)

    def eventFilter(self, obj, event) -> bool:  # noqa: N802
        if event.type() == QEvent.KeyPress and event.matches(QKeySequence.Paste):
            if self._clipboard_has_image():
                self.on_paste()
                return True
        return super().eventFilter(obj, event)

    def _clipboard_has_image(self) -> bool:
        """剪贴板里是否有可识别的图片（位图数据或本地图片文件）。"""
        clipboard = QGuiApplication.clipboard()
        if not clipboard.image().isNull():
            return True
        mime = clipboard.mimeData()
        if mime is not None and mime.hasUrls():
            return any(
                url.toLocalFile().lower().endswith(self._IMAGE_EXTS)
                for url in mime.urls()
            )
        return False

    def _apply_style(self) -> None:
        self.setStyleSheet(
            """
            QMainWindow, QWidget { background:#2b2d31; color:#e6e6e6;
                font-size:14px; }
            QPushButton { background:#3a3d44; border:1px solid #4a4d55;
                border-radius:6px; padding:6px 14px; }
            QPushButton:hover { background:#454953; }
            QPushButton:disabled { color:#777; background:#33353a; }
            QPushButton#primary { background:#3fb950; border:none; color:#0d1117;
                font-weight:600; }
            QPushButton#primary:hover { background:#46c95a; }
            QPushButton#primary:disabled { background:#2f5a37; color:#88a; }
            QPlainTextEdit { background:#1e1f22; border:1px solid #3a3d44;
                border-radius:6px; padding:8px; selection-background-color:#3fb950; }
            QLabel { color:#c8c8c8; }
            QStatusBar { color:#9aa0a6; }
            """
        )

    # ---------------------------------------------------------------- #
    # 模型预热
    def _start_warmup(self) -> None:
        self.btn_ocr.setEnabled(False)
        self._warmup_worker = WarmupWorker(self.engine)
        self._warmup_worker.done.connect(self._on_warmup_done)
        self._warmup_worker.failed.connect(self._on_warmup_failed)
        self._warmup_worker.start()

    def _on_warmup_done(self) -> None:
        self.btn_ocr.setEnabled(True)
        self.status.showMessage("模型已就绪，可以开始识别。", 5000)

    def _on_warmup_failed(self, msg: str) -> None:
        self.btn_ocr.setEnabled(True)  # 仍允许尝试，识别时会再报错
        self.status.showMessage("模型预加载失败，将在首次识别时重试。")
        print(msg)

    # ---------------------------------------------------------------- #
    # 输入
    def on_open(self) -> None:
        path, _ = QFileDialog.getOpenFileName(
            self,
            "选择图片或 PDF",
            "",
            "图片或 PDF (*.png *.jpg *.jpeg *.bmp *.webp *.tiff *.tif *.gif *.pdf);;"
            "图片文件 (*.png *.jpg *.jpeg *.bmp *.webp *.tiff *.tif *.gif);;"
            "PDF 文件 (*.pdf)",
        )
        if path:
            self.load_path(path)

    def load_path(self, path: str) -> None:
        """根据扩展名分发到图片或 PDF 加载。"""
        if path.lower().endswith(".pdf"):
            self.load_pdf(path)
        else:
            self._reset_pdf_state()
            self.load_image(path)

    # 支持的图片扩展名（粘贴文件、拖拽时用于过滤）。
    _IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".bmp", ".webp", ".tiff", ".tif", ".gif")

    def on_paste(self) -> None:
        clipboard = QGuiApplication.clipboard()

        # 1) 剪贴板里是位图像素数据（系统截图 ⌘⇧⌃4 / 从图片编辑器复制选区）。
        image = clipboard.image()
        if not image.isNull():
            path = self._dump_temp_png(QPixmap.fromImage(image))
            if path:
                self._reset_pdf_state()
                self.load_image(path, auto_ocr=True)
            else:
                self.status.showMessage("保存剪贴板图片失败。", 4000)
            return

        # 2) 剪贴板里是文件引用（在 Finder/浏览器中"复制图片文件"）：取本地图片路径。
        mime = clipboard.mimeData()
        if mime is not None and mime.hasUrls():
            for url in mime.urls():
                local = url.toLocalFile()
                if local and local.lower().endswith(self._IMAGE_EXTS):
                    self._reset_pdf_state()
                    self.load_image(local, auto_ocr=True)
                    return

        self.status.showMessage("剪贴板里没有可识别的图片。", 4000)

    def _dump_temp_png(self, pixmap: QPixmap) -> Optional[str]:
        """把 QPixmap 存为临时 PNG，返回路径。"""
        tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
        tmp.close()
        if pixmap.save(tmp.name, "PNG"):
            self._temp_files.append(tmp.name)
            return tmp.name
        return None

    def load_image(self, path: str, auto_ocr: bool = False) -> None:
        pixmap = QPixmap(path)
        if pixmap.isNull():
            QMessageBox.warning(self, "无法打开", f"无法加载图片：\n{path}")
            return
        self._current_image_path = path
        self.image_view.set_pixmap(pixmap)
        self.text_edit.clear()
        self._last_result = None
        name = os.path.basename(path)
        self.status.showMessage(f"已载入：{name}（{pixmap.width()}×{pixmap.height()}）")
        if auto_ocr:
            self.on_ocr()

    # ---------------------------------------------------------------- #
    # PDF
    def load_pdf(self, path: str) -> None:
        # 加密 PDF：循环向用户索要密码，直至解锁成功或用户取消。
        password = ""
        while True:
            try:
                count = pdf_loader.get_page_count(path, password)
                break
            except pdf_loader.PdfPasswordRequired as exc:
                text, ok = QInputDialog.getText(
                    self,
                    "PDF 已加密",
                    "密码错误，请重新输入：" if exc.incorrect else "请输入 PDF 打开密码：",
                    QLineEdit.Password,
                )
                if not ok:
                    self.status.showMessage("已取消：未输入 PDF 密码。", 4000)
                    return
                password = text
            except pdf_loader.PdfError as exc:
                QMessageBox.warning(self, "无法打开 PDF", str(exc))
                return
        if count <= 0:
            QMessageBox.warning(self, "无法打开 PDF", "该 PDF 没有可渲染的页面。")
            return
        self._pdf_path = path
        self._pdf_page_count = count
        self._pdf_index = 0
        self._pdf_password = password
        self._show_pdf_page(0)

    def _show_pdf_page(self, index: int) -> None:
        if not self._pdf_path:
            return
        index = max(0, min(index, self._pdf_page_count - 1))
        try:
            pixmap = pdf_loader.render_page(
                self._pdf_path, index, password=self._pdf_password
            )
        except pdf_loader.PdfError as exc:
            QMessageBox.warning(self, "渲染失败", str(exc))
            return
        self._pdf_index = index
        # 渲染结果存为临时 PNG，复用现有图片识别/导出流程
        png = self._dump_temp_png(pixmap)
        if not png:
            self.status.showMessage("渲染 PDF 页失败。", 4000)
            return
        self._current_image_path = png
        self.image_view.set_pixmap(pixmap)
        self.text_edit.clear()
        self._last_result = None
        self._update_pdf_nav()
        name = os.path.basename(self._pdf_path)
        self.status.showMessage(
            f"已载入 PDF：{name} 第 {index + 1}/{self._pdf_page_count} 页"
        )

    def _update_pdf_nav(self) -> None:
        is_pdf = self._pdf_path is not None and self._pdf_page_count > 0
        for w in (self.btn_prev, self.spin_page, self.lbl_page_total, self.btn_next):
            w.setVisible(is_pdf)
        if is_pdf:
            # setValue/setMaximum 只会触发 valueChanged，不会触发 editingFinished，
            # 因此这里同步当前页码不会反过来触发跳转，无需阻塞信号。
            self.spin_page.setMaximum(self._pdf_page_count)
            self.spin_page.setValue(self._pdf_index + 1)
            self.lbl_page_total.setText(f"/ {self._pdf_page_count}")
            self.btn_prev.setEnabled(self._pdf_index > 0)
            self.btn_next.setEnabled(self._pdf_index < self._pdf_page_count - 1)

    def on_prev_page(self) -> None:
        if self._pdf_path and self._pdf_index > 0:
            self._show_pdf_page(self._pdf_index - 1)

    def on_next_page(self) -> None:
        if self._pdf_path and self._pdf_index < self._pdf_page_count - 1:
            self._show_pdf_page(self._pdf_index + 1)

    def on_jump_page(self) -> None:
        """页码输入框回车/失焦：跳转到指定页。"""
        if not self._pdf_path:
            return
        target = self.spin_page.value() - 1
        if target != self._pdf_index:
            self._show_pdf_page(target)

    def _reset_pdf_state(self) -> None:
        self._pdf_path = None
        self._pdf_page_count = 0
        self._pdf_index = 0
        self._pdf_password = ""
        self._update_pdf_nav()

    # ---------------------------------------------------------------- #
    # 截图识别
    def on_capture(self) -> None:
        if self._overlay is not None:
            return
        # 先隐藏主窗口，避免遮挡要截取的内容；稍作延迟等窗口动画完成
        self.showMinimized()
        QTimer.singleShot(250, self._do_capture)

    def _do_capture(self) -> None:
        self._overlay = ScreenCaptureOverlay()
        self._overlay.captured.connect(self._on_captured)
        self._overlay.cancelled.connect(self._on_capture_cancelled)
        self._overlay.show()
        self._overlay.activateWindow()
        self._overlay.raise_()

    def _on_captured(self, pixmap: QPixmap) -> None:
        self._overlay = None
        self.showNormal()
        self.raise_()
        self.activateWindow()
        path = self._dump_temp_png(pixmap)
        if path:
            self._reset_pdf_state()
            self.load_image(path, auto_ocr=True)
        else:
            self.status.showMessage("保存截图失败。", 4000)

    def _on_capture_cancelled(self) -> None:
        self._overlay = None
        self.showNormal()
        self.raise_()
        self.activateWindow()
        self.status.showMessage("已取消截图。", 3000)

    # ---------------------------------------------------------------- #
    # 识别
    def on_ocr(self) -> None:
        if not self._current_image_path:
            self.status.showMessage("请先打开或粘贴一张图片。", 4000)
            return
        if self._ocr_worker and self._ocr_worker.isRunning():
            return
        self.btn_ocr.setEnabled(False)
        self.btn_ocr.setText("识别中…")
        self.status.showMessage("正在识别…")

        self._ocr_worker = OcrWorker(self.engine, self._current_image_path)
        self._ocr_worker.done.connect(self._on_ocr_done)
        self._ocr_worker.failed.connect(self._on_ocr_failed)
        self._ocr_worker.start()

    def _on_ocr_done(self, result: OcrResult) -> None:
        self.btn_ocr.setEnabled(True)
        self.btn_ocr.setText("开始识别")
        self._last_result = result
        self.text_edit.setPlainText(result.full_text)
        self.image_view.set_lines(result.lines)
        self.status.showMessage(
            f"识别完成：{len(result.lines)} 行，耗时 {result.elapsed:.2f}s"
        )

    def _on_ocr_failed(self, msg: str) -> None:
        self.btn_ocr.setEnabled(True)
        self.btn_ocr.setText("开始识别")
        self.status.showMessage("识别失败，详见弹窗。")
        QMessageBox.critical(self, "识别失败", msg[-2000:])

    # ---------------------------------------------------------------- #
    # 导出 / 复制
    def on_export(self) -> None:
        if not self._last_result or not self._last_result.lines:
            self.status.showMessage("没有可导出的识别结果。", 4000)
            return
        path, selected = QFileDialog.getSaveFileName(
            self,
            "导出识别结果",
            "ocr_result.txt",
            "文本文件 (*.txt);;JSON 文件 (*.json)",
        )
        if not path:
            return
        try:
            is_json = path.lower().endswith(".json") or "json" in selected.lower()
            if is_json and not path.lower().endswith(".json"):
                path += ".json"
            elif not is_json and not path.lower().endswith(".txt"):
                path += ".txt"

            if is_json:
                data = [
                    {"text": ln.text, "score": round(ln.score, 4), "box": ln.box}
                    for ln in self._last_result.lines
                ]
                with open(path, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
            else:
                with open(path, "w", encoding="utf-8") as f:
                    f.write(self._last_result.full_text)
            self.status.showMessage(f"已导出：{os.path.basename(path)}", 5000)
        except OSError as exc:
            QMessageBox.critical(self, "导出失败", str(exc))

    def on_copy(self) -> None:
        text = self.text_edit.toPlainText()
        if text:
            QApplication.clipboard().setText(text)
            self.status.showMessage("已复制到剪贴板。", 3000)

    def on_clear(self) -> None:
        self.text_edit.clear()
        self.image_view.set_lines([])
        self._last_result = None

    # ---------------------------------------------------------------- #
    def closeEvent(self, event) -> None:  # noqa: N802
        for f in self._temp_files:
            try:
                os.remove(f)
            except OSError:
                pass
        super().closeEvent(event)
