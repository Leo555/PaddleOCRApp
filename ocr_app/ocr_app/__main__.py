"""程序入口：python -m ocr_app"""
from __future__ import annotations

import sys

from PySide6.QtWidgets import QApplication

from .main_window import MainWindow, app_icon


def main() -> int:
    app = QApplication(sys.argv)
    app.setApplicationName("PaddleOCRApp")
    app.setWindowIcon(app_icon())  # Dock / 任务栏图标
    window = MainWindow()
    window.show()
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
