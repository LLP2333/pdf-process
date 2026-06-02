"""文件目录约定与简单清理。

uploads/<doc_id>/source.pdf         上传的原始 PDF
outputs/<doc_id>/page_<n>.png       预览图(供前端 Konva 叠加画框)
outputs/<doc_id>/export.<ext>       最近一次导出的成品
"""
from __future__ import annotations

import os
import shutil
import time
import uuid
from pathlib import Path

# 默认在仓库根(backend 上一级)放 uploads/outputs,容器内由 EXAM_SPLITTER_DATA_DIR 覆盖到 /data
BASE_DIR = Path(os.environ.get("EXAM_SPLITTER_DATA_DIR", Path(__file__).resolve().parents[2])).resolve()
UPLOAD_DIR = BASE_DIR / "uploads"
OUTPUT_DIR = BASE_DIR / "outputs"

# 文档保留时长,超期由 maintenance() 清理
RETENTION_SECONDS = int(os.environ.get("EXAM_SPLITTER_RETENTION", str(24 * 3600)))


def ensure_dirs() -> None:
    """保证 `uploads/`、`outputs/` 存在,启动时调一次即可。"""
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def new_doc_id() -> str:
    """生成一个 16 位 16 进制字符串作为文档 ID(冲突概率可忽略)。"""
    return uuid.uuid4().hex[:16]


def upload_path(doc_id: str) -> Path:
    """上传源文件落盘位置。"""
    return UPLOAD_DIR / doc_id / "source.pdf"


def output_dir(doc_id: str) -> Path:
    """该文档的所有派生产物目录(预览 PNG + 导出文件)。"""
    return OUTPUT_DIR / doc_id


def page_image_path(doc_id: str, page_index: int) -> Path:
    """某一页的预览 PNG 路径(命名严格 `page_NNN.png`)。"""
    return output_dir(doc_id) / f"page_{page_index:03d}.png"


def export_path(doc_id: str, ext: str) -> Path:
    """导出产物路径,文件名固定为 `export.<ext>`。"""
    return output_dir(doc_id) / f"export.{ext}"


def maintenance(now: float | None = None) -> None:
    """清理超过 `RETENTION_SECONDS` 的 doc(uploads 与 outputs 都扫)。"""
    ensure_dirs()
    cutoff = (now or time.time()) - RETENTION_SECONDS
    for root in (UPLOAD_DIR, OUTPUT_DIR):
        for entry in root.iterdir():
            if not entry.is_dir():
                continue
            try:
                if entry.stat().st_mtime < cutoff:
                    shutil.rmtree(entry, ignore_errors=True)
            except FileNotFoundError:
                pass
