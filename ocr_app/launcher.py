"""PyInstaller 打包入口。

PyInstaller 需要一个可直接运行的脚本作为入口，而 `python -m ocr_app`
依赖包的相对导入，不适合直接喂给 PyInstaller。这里以绝对导入调用包内的
main()，既保留 `python -m ocr_app` 的开发用法，又给打包提供稳定入口。
"""
from ocr_app.__main__ import main

if __name__ == "__main__":
    raise SystemExit(main())
