"""storage 模块行为测试。"""
from __future__ import annotations

import time
from pathlib import Path

from app import storage


def test_paths_compose_correctly(tmp_storage: Path) -> None:
    doc_id = "abc123"
    assert storage.upload_path(doc_id).name == "source.pdf"
    assert storage.output_dir(doc_id).name == doc_id
    assert storage.page_image_path(doc_id, 0).name == "page_000.png"
    assert storage.page_image_path(doc_id, 12).name == "page_012.png"
    assert storage.export_path(doc_id, "pdf").name == "export.pdf"


def test_new_doc_id_format() -> None:
    doc_id = storage.new_doc_id()
    assert len(doc_id) == 16
    assert all(c in "0123456789abcdef" for c in doc_id)


def test_maintenance_removes_old_dirs(tmp_storage: Path, monkeypatch) -> None:
    monkeypatch.setattr(storage, "RETENTION_SECONDS", 60)

    old = storage.UPLOAD_DIR / "old"
    old.mkdir()
    (old / "source.pdf").write_bytes(b"x")
    fresh = storage.UPLOAD_DIR / "fresh"
    fresh.mkdir()
    (fresh / "source.pdf").write_bytes(b"x")

    # 让 `old` 的 mtime 倒退到很久以前
    far_past = time.time() - 3600
    import os

    os.utime(old, (far_past, far_past))

    storage.maintenance()

    assert not old.exists()
    assert fresh.exists()
