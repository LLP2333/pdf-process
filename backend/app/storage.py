"""文件目录约定与清理 / 配额策略。

uploads/<doc_id>/source.pdf         上传的原始 PDF
outputs/<doc_id>/page_<n>.png       预览图(供前端 Konva 叠加画框)
outputs/<doc_id>/export.<ext>       最近一次导出的成品

环境变量(全部都有合理默认值,无需配置即可启动):

- `EXAM_SPLITTER_DATA_DIR`         数据根目录,容器里通常映射到 `/data`
- `EXAM_SPLITTER_RETENTION`        单个 doc 保留秒数,默认 86400(24h)
- `EXAM_SPLITTER_MAX_UPLOAD_MB`    单文件上传上限(MB),默认 64
- `EXAM_SPLITTER_MAX_STORAGE_MB`   uploads+outputs 总占用软上限(MB),默认 2048(2GB)
- `EXAM_SPLITTER_PROTECT_SECONDS`  LRU 清理保护期:最近 N 秒动过的 doc 不会被强制清理,默认 300(5min)
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

# 单文件上传上限。FastAPI 路由会按此值流式校验,超出立即 413。
MAX_UPLOAD_BYTES = int(os.environ.get("EXAM_SPLITTER_MAX_UPLOAD_MB", "64")) * 1024 * 1024

# uploads + outputs 总占用的"软上限"。
# - 软:超过后由 maintenance() 按 LRU 主动清理旧 doc 直到 ≤ 80% 水位,而不是直接拒绝写入。
# - 但若单次上传完成后仍 > 上限(单文件就超),依然给前端 507 提示。
MAX_STORAGE_BYTES = int(os.environ.get("EXAM_SPLITTER_MAX_STORAGE_MB", "2048")) * 1024 * 1024

# LRU 清理保护期:最近 N 秒内 mtime 的 doc 不动,避免删别人正在使用的文档。
PROTECT_SECONDS = int(os.environ.get("EXAM_SPLITTER_PROTECT_SECONDS", "300"))


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


def storage_usage_bytes() -> int:
    """累加 uploads + outputs 下所有文件大小。

    供 maintenance() 与上传后软上限校验使用。开销:只扫两棵子树,且单次上传后只调用一次。
    若 doc 目录中途被并发删,FileNotFoundError 静默跳过(允许略小的近似值)。
    """
    total = 0
    for root in (UPLOAD_DIR, OUTPUT_DIR):
        if not root.exists():
            continue
        for p in root.rglob("*"):
            try:
                if p.is_file():
                    total += p.stat().st_size
            except FileNotFoundError:
                pass
    return total


def _doc_dir_mtime(doc_id: str) -> float:
    """取 doc 的"最后活跃时间":uploads 与 outputs 目录 mtime 取较大者。

    导出 / 预览会改 outputs 的 mtime,所以"活跃 doc"不会被错误地按上传时间判旧。
    """
    latest = 0.0
    for root in (UPLOAD_DIR, OUTPUT_DIR):
        d = root / doc_id
        try:
            latest = max(latest, d.stat().st_mtime)
        except FileNotFoundError:
            pass
    return latest


def _list_doc_ids() -> list[str]:
    """uploads 与 outputs 下所有 doc_id 目录名的并集(去重,保持稳定排序无要求)。"""
    ids: set[str] = set()
    for root in (UPLOAD_DIR, OUTPUT_DIR):
        if not root.exists():
            continue
        for entry in root.iterdir():
            if entry.is_dir():
                ids.add(entry.name)
    return list(ids)


def _drop_doc(doc_id: str) -> None:
    """同时移除 uploads 与 outputs 下的该 doc 目录(任一缺失都忽略)。"""
    shutil.rmtree(UPLOAD_DIR / doc_id, ignore_errors=True)
    shutil.rmtree(OUTPUT_DIR / doc_id, ignore_errors=True)


def maintenance(now: float | None = None) -> None:
    """清理职责合一:① 过期(>RETENTION_SECONDS)的 doc;② 总占用超过 MAX_STORAGE_BYTES 时按 LRU 续删。

    第二阶段的核心约束:
    - 只删 mtime 落在"保护期"之外(`now - PROTECT_SECONDS`)的 doc,避免误删正在用的文档。
    - 按 mtime 升序删,直到总占用 ≤ 80% MAX_STORAGE_BYTES(留 buffer 避免反复触发)。
    - 若保护期外没东西可删了仍超限,不再强删 —— 让 upload 路由的 507 兜底。
    """
    ensure_dirs()
    t = now or time.time()
    cutoff = t - RETENTION_SECONDS
    for root in (UPLOAD_DIR, OUTPUT_DIR):
        for entry in root.iterdir():
            if not entry.is_dir():
                continue
            try:
                if entry.stat().st_mtime < cutoff:
                    shutil.rmtree(entry, ignore_errors=True)
            except FileNotFoundError:
                pass

    if storage_usage_bytes() <= MAX_STORAGE_BYTES:
        return

    protect_after = t - PROTECT_SECONDS
    candidates = [(_doc_dir_mtime(d), d) for d in _list_doc_ids()]
    candidates = [c for c in candidates if c[0] > 0 and c[0] <= protect_after]
    candidates.sort()

    target = int(MAX_STORAGE_BYTES * 0.8)
    for _, doc_id in candidates:
        if storage_usage_bytes() <= target:
            break
        _drop_doc(doc_id)
