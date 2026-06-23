"""OCR 推理引擎封装（后端：RapidOCR / ONNX Runtime）。

说明：
本项目目标是「基于 PaddleOCR 的桌面 OCR 工具」。在 Apple Silicon + x86_64(Rosetta)
的 Python 环境下，paddlepaddle 无法运行当前 PP-OCR 模型（仅有 3.0.0 的 x86_64
wheel，且其 PIR 推理器解析新模型时报 int64 strides 错误，paddle2onnx 的 wheel
又存在架构不匹配问题）。因此推理后端改用 RapidOCR —— 它使用的正是 PaddleOCR 的
PP-OCR 检测/方向分类/识别模型转换成的 ONNX 版本，通过 ONNX Runtime 运行，
跨平台稳定、自带模型可离线使用。对外接口保持不变。

- 懒加载模型（首次识别时才初始化，避免启动卡顿）
- 将 RapidOCR 的输出统一解析为简洁的数据结构
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, List, Union

import numpy as np


@dataclass
class OcrLine:
    """单行识别结果。"""

    text: str
    score: float
    box: List[List[float]]  # 四个角点 [[x, y], ...]


@dataclass
class OcrResult:
    """一次识别的完整结果。"""

    lines: List[OcrLine] = field(default_factory=list)
    elapsed: float = 0.0

    @property
    def full_text(self) -> str:
        return "\n".join(line.text for line in self.lines)


# 界面下拉框展示名 -> 引擎内部语言标识。
# RapidOCR 默认 PP-OCRv4 中文模型已同时覆盖中文、英文与数字，
# 这也是 PaddleOCR 中英文场景最常用的模型。
SUPPORTED_LANGS = {
    "中文 / 英文（默认）": "ch",
}


class OcrEngine:
    """RapidOCR 的薄封装。线程安全性由调用方（worker）保证：
    同一时间只在一个后台线程里调用 recognize。
    """

    def __init__(self, lang: str = "ch") -> None:
        self.lang = lang
        self._ocr: Any = None

    # ------------------------------------------------------------------ #
    def set_lang(self, lang: str) -> None:
        """切换识别语言，下次识别时重新加载模型。"""
        if lang != self.lang:
            self.lang = lang
            self._ocr = None

    def is_loaded(self) -> bool:
        return self._ocr is not None

    # ------------------------------------------------------------------ #
    def _ensure(self) -> Any:
        if self._ocr is None:
            from rapidocr_onnxruntime import RapidOCR

            # 默认参数即加载 PP-OCRv4 中/英检测+方向分类+识别 ONNX 模型。
            self._ocr = RapidOCR()
        return self._ocr

    def warmup(self) -> None:
        """预加载模型（供后台线程在启动时调用）。"""
        self._ensure()

    # ------------------------------------------------------------------ #
    def recognize(self, image: Union[str, np.ndarray]) -> OcrResult:
        ocr = self._ensure()
        start = time.time()
        raw, _elapse = ocr(image)
        elapsed = time.time() - start
        return self._parse(raw, elapsed)

    # ------------------------------------------------------------------ #
    @classmethod
    def _parse(cls, raw: Any, elapsed: float) -> OcrResult:
        result = OcrResult(elapsed=elapsed)
        if not raw:
            return result

        # RapidOCR 返回 [[box, text, score], ...]
        for item in raw:
            try:
                box, text, score = item[0], item[1], item[2]
            except (TypeError, IndexError):
                continue
            result.lines.append(
                OcrLine(
                    text=str(text),
                    score=float(score) if score is not None else 0.0,
                    box=cls._normalize_box(box),
                )
            )
        return result

    @staticmethod
    def _normalize_box(poly: Any) -> List[List[float]]:
        """把坐标格式统一成多边形角点列表 [[x, y], ...]。"""
        if poly is None:
            return []
        arr = np.asarray(poly, dtype=float)
        if arr.ndim == 1 and arr.size == 4:  # 轴对齐框 [x1,y1,x2,y2]
            x1, y1, x2, y2 = arr.tolist()
            return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]
        if arr.ndim == 2 and arr.shape[1] == 2:
            return arr.tolist()
        return []
