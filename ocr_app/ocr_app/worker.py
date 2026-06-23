"""后台线程 worker：模型加载与 OCR 识别均放到子线程，避免阻塞 UI。"""
from __future__ import annotations

import traceback
from typing import Union

import numpy as np
from PySide6.QtCore import QThread, Signal

from .engine import OcrEngine, OcrResult


class WarmupWorker(QThread):
    """后台预加载模型。"""

    done = Signal()
    failed = Signal(str)

    def __init__(self, engine: OcrEngine) -> None:
        super().__init__()
        self.engine = engine

    def run(self) -> None:  # noqa: D401
        try:
            self.engine.warmup()
            self.done.emit()
        except Exception:
            self.failed.emit(traceback.format_exc())


class OcrWorker(QThread):
    """后台执行一次 OCR 识别。"""

    done = Signal(object)  # OcrResult
    failed = Signal(str)

    def __init__(self, engine: OcrEngine, image: Union[str, np.ndarray]) -> None:
        super().__init__()
        self.engine = engine
        self.image = image

    def run(self) -> None:  # noqa: D401
        try:
            result: OcrResult = self.engine.recognize(self.image)
            self.done.emit(result)
        except Exception:
            self.failed.emit(traceback.format_exc())
