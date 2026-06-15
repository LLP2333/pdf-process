# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller 打包配置:把 launcher.py + 后端 app 包 + 前端 dist 打成单文件 exe。

构建方式(在仓库根目录执行,需先 `npm run build` 产出 frontend/dist):
    pyinstaller --noconfirm --clean desktop/exam_splitter.spec
产物:dist/ExamSplitter.exe

说明:
- `SPECPATH` 由 PyInstaller 注入,等于本 spec 所在目录(desktop/),据此推回仓库根。
- uvicorn / fastapi / pptx / pymupdf 等存在大量动态导入与数据文件,
  统一用 collect_all 把子模块、二进制、数据文件一网打尽,避免运行时 ImportError。
"""
import os

from PyInstaller.utils.hooks import collect_all

HERE = SPECPATH
ROOT = os.path.dirname(HERE)
BACKEND_DIR = os.path.join(ROOT, "backend")
FRONTEND_DIST = os.path.join(ROOT, "frontend", "dist")
LAUNCHER = os.path.join(HERE, "launcher.py")

if not os.path.isdir(FRONTEND_DIST):
    raise SystemExit(
        f"未找到前端构建产物 {FRONTEND_DIST};请先在 frontend 目录执行 `npm ci && npm run build`。"
    )

# 把前端构建产物原样塞进 exe,运行时解包到 sys._MEIPASS/frontend_dist。
datas = [(FRONTEND_DIST, "frontend_dist")]
binaries = []
hiddenimports = ["app", "app.main", "app.pdf_service", "app.ppt_service", "app.storage", "app.schemas"]

# 这些包含动态导入 / 随包数据(模板、二进制库),用 collect_all 全量收集最稳。
for package_name in (
    "uvicorn",
    "fastapi",
    "starlette",
    "anyio",
    "pydantic",
    "pydantic_core",
    "pptx",
    "pymupdf",
    "fitz",
    "multipart",
):
    try:
        collected_datas, collected_binaries, collected_hiddenimports = collect_all(package_name)
        datas += collected_datas
        binaries += collected_binaries
        hiddenimports += collected_hiddenimports
    except Exception:
        # 某些别名包(如 fitz 由 pymupdf 提供)可能收集不到,跳过即可。
        pass

analysis = Analysis(
    [LAUNCHER],
    pathex=[BACKEND_DIR],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["pytest", "httpx", "tkinter.test", "test"],
    noarchive=False,
)

pyz = PYZ(analysis.pure, analysis.zipped_data)

exe = EXE(
    pyz,
    analysis.scripts,
    analysis.binaries,
    analysis.zipfiles,
    analysis.datas,
    [],
    name="ExamSplitter",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    runtime_tmpdir=None,
    console=False,  # 用 Tk 窗口做交互,不弹黑色控制台
)
