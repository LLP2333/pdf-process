"""FastAPI 接口集成测试(走 TestClient,无需起 HTTP server)。"""
from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient


def test_health(client: TestClient) -> None:
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_upload_rejects_non_pdf(client: TestClient) -> None:
    resp = client.post(
        "/api/upload",
        files={"file": ("a.txt", b"hello", "text/plain")},
    )
    assert resp.status_code == 400
    assert "PDF" in resp.json()["detail"]


def test_upload_rejects_empty_file(client: TestClient) -> None:
    resp = client.post(
        "/api/upload",
        files={"file": ("empty.pdf", b"", "application/pdf")},
    )
    assert resp.status_code == 400


def test_upload_invalid_pdf_returns_422(client: TestClient) -> None:
    resp = client.post(
        "/api/upload",
        files={"file": ("bad.pdf", b"not a real pdf", "application/pdf")},
    )
    assert resp.status_code == 422
    assert "PDF" in resp.json()["detail"]


def test_full_flow_upload_pages_export(client: TestClient, sample_pdf: Path) -> None:
    # 1) upload
    with sample_pdf.open("rb") as fh:
        resp = client.post(
            "/api/upload",
            files={"file": (sample_pdf.name, fh.read(), "application/pdf")},
        )
    assert resp.status_code == 200
    body = resp.json()
    doc_id = body["doc_id"]
    assert body["page_count"] == 2
    assert len(body["pages"]) == 2

    # 2) page image
    page_url = body["pages"][0]["image_url"]
    img = client.get(page_url)
    assert img.status_code == 200
    assert img.headers["content-type"] == "image/png"
    assert img.content.startswith(b"\x89PNG")

    # 3) bad image name 404
    assert client.get(f"/api/pages/{doc_id}/etc..passwd").status_code == 404

    # 4) export pdf
    payload = {
        "format": "pdf",
        "margin": 28,
        "questions": [
            {"no": 1, "segments": [{"page": 0, "y1": 120, "y2": 300}]},
            {"no": 2, "segments": [{"page": 0, "y1": 300, "y2": 500}, {"page": 1, "y1": 120, "y2": 240}]},
        ],
    }
    resp = client.post(f"/api/export/{doc_id}", json=payload)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.headers["x-question-count"] == "2"
    assert resp.content.startswith(b"%PDF")

    # 5) export pptx
    payload["format"] = "pptx"
    resp = client.post(f"/api/export/{doc_id}", json=payload)
    assert resp.status_code == 200
    assert "presentationml" in resp.headers["content-type"]
    assert resp.headers["x-question-count"] == "2"
    assert len(resp.content) > 0


def test_export_nonexistent_doc_returns_404(client: TestClient) -> None:
    payload = {
        "format": "pdf",
        "margin": 28,
        "questions": [{"no": 1, "segments": [{"page": 0, "y1": 0, "y2": 10}]}],
    }
    resp = client.post("/api/export/deadbeef", json=payload)
    assert resp.status_code == 404


def test_export_all_invalid_segments_returns_422(client: TestClient, sample_pdf: Path) -> None:
    with sample_pdf.open("rb") as fh:
        resp = client.post(
            "/api/upload",
            files={"file": (sample_pdf.name, fh.read(), "application/pdf")},
        )
    doc_id = resp.json()["doc_id"]

    payload = {
        "format": "pdf",
        "margin": 28,
        "questions": [{"no": 1, "segments": [{"page": 99, "y1": 0, "y2": 10}]}],
    }
    resp = client.post(f"/api/export/{doc_id}", json=payload)
    assert resp.status_code == 422


def test_preview_returns_png(client: TestClient, sample_pdf: Path) -> None:
    with sample_pdf.open("rb") as fh:
        up = client.post("/api/upload", files={"file": (sample_pdf.name, fh.read(), "application/pdf")})
    doc_id = up.json()["doc_id"]

    payload = {
        "question": {"no": 1, "segments": [{"page": 0, "y1": 80, "y2": 400}]},
        "auto_trim": True,
    }
    resp = client.post(f"/api/preview/{doc_id}", json=payload)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"
    assert resp.headers.get("x-empty") is None
    assert resp.content.startswith(b"\x89PNG")


def test_preview_empty_segments_returns_x_empty_header(client: TestClient, sample_pdf: Path) -> None:
    with sample_pdf.open("rb") as fh:
        up = client.post("/api/upload", files={"file": (sample_pdf.name, fh.read(), "application/pdf")})
    doc_id = up.json()["doc_id"]

    payload = {
        "question": {"no": 1, "segments": [{"page": 99, "y1": 0, "y2": 10}]},
        "auto_trim": True,
    }
    resp = client.post(f"/api/preview/{doc_id}", json=payload)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"
    assert resp.headers.get("x-empty") == "1"


def test_preview_nonexistent_doc_returns_404(client: TestClient) -> None:
    payload = {
        "question": {"no": 1, "segments": [{"page": 0, "y1": 0, "y2": 10}]},
        "auto_trim": True,
    }
    resp = client.post("/api/preview/deadbeef", json=payload)
    assert resp.status_code == 404


def test_invalid_doc_id_rejected_uniformly(client: TestClient) -> None:
    """doc_id 必须是 16 位小写 hex,任何其他形式(含路径遍历尝试)统一 404。"""
    # 长度不对 / 大写 / 含非 hex 字符
    for bad in ["short", "DEADBEEFDEADBEEF", "z1234567890abcde", "1234567890abcde"]:
        resp = client.post(
            f"/api/preview/{bad}",
            json={"question": {"no": 1, "segments": [{"page": 0, "y1": 0, "y2": 10}]}},
        )
        assert resp.status_code == 404, f"bad doc_id {bad!r} should 404"

    # 路径遍历尝试(都不该命中真实文件;统一 404)
    for bad in ["..", "../etc", "%2e%2e"]:
        resp = client.get(f"/api/pages/{bad}/page_000.png")
        assert resp.status_code == 404


def test_upload_oversize_rejected(client: TestClient, monkeypatch) -> None:
    """单文件 > MAX_UPLOAD_BYTES 返回 413,并且半成品被清掉(不污染磁盘)。"""
    from app import storage

    # 把上限调到 1KB,造一份 4KB 的"PDF"试上传
    monkeypatch.setattr(storage, "MAX_UPLOAD_BYTES", 1024)
    payload = b"%PDF-1.4\n" + b"x" * (4 * 1024)
    resp = client.post(
        "/api/upload",
        files={"file": ("big.pdf", payload, "application/pdf")},
    )
    assert resp.status_code == 413
    assert "MB" in resp.json()["detail"]
    # uploads/ 不应残留半成品 doc 目录
    assert not any(storage.UPLOAD_DIR.iterdir())


def test_upload_triggers_lru_when_over_storage_cap(
    client: TestClient, sample_pdf, monkeypatch
) -> None:
    """总占用 > MAX_STORAGE_BYTES 时,新上传会按 LRU 清掉保护期外的旧 doc。"""
    import os
    import time

    from app import storage

    monkeypatch.setattr(storage, "MAX_STORAGE_BYTES", 2 * 1024 * 1024)  # 2MB
    monkeypatch.setattr(storage, "PROTECT_SECONDS", 60)

    # 造一个"很旧的" doc(mtime 推回 1 小时前)占 4MB,直接超软上限
    old_id = "0123456789abcdef"
    (storage.UPLOAD_DIR / old_id).mkdir(parents=True)
    (storage.UPLOAD_DIR / old_id / "source.pdf").write_bytes(b"x" * 4 * 1024 * 1024)
    (storage.OUTPUT_DIR / old_id).mkdir(parents=True)
    far_past = time.time() - 3600
    for p in (storage.UPLOAD_DIR / old_id, storage.OUTPUT_DIR / old_id):
        os.utime(p, (far_past, far_past))

    # 上传新文件,触发软上限 → LRU 应清掉 old_id
    with sample_pdf.open("rb") as fh:
        resp = client.post(
            "/api/upload",
            files={"file": (sample_pdf.name, fh.read(), "application/pdf")},
        )
    assert resp.status_code == 200
    assert not (storage.UPLOAD_DIR / old_id).exists(), "保护期外的旧 doc 应该被 LRU 清掉"


def test_upload_lru_respects_protect_window(
    client: TestClient, sample_pdf, monkeypatch
) -> None:
    """保护期内的旧 doc 不会被强制 LRU 清掉,即便仍超软上限也只是软超(不抛 507,除非清不下来后)。"""
    from app import storage

    monkeypatch.setattr(storage, "MAX_STORAGE_BYTES", 2 * 1024 * 1024)
    monkeypatch.setattr(storage, "PROTECT_SECONDS", 3600)  # 把所有 doc 都圈进保护期

    # 造个"刚刚活跃"的 doc 占 4MB(>软上限),且 mtime 落在保护期内
    busy_id = "fedcba9876543210"
    (storage.UPLOAD_DIR / busy_id).mkdir(parents=True)
    (storage.UPLOAD_DIR / busy_id / "source.pdf").write_bytes(b"y" * 4 * 1024 * 1024)

    with sample_pdf.open("rb") as fh:
        # 此次上传成功(渲染前 sample_pdf ~几 KB,叠加超出软上限 → 507)
        resp = client.post(
            "/api/upload",
            files={"file": (sample_pdf.name, fh.read(), "application/pdf")},
        )
    # 保护期内动不了 busy_id,清不下来 → 507 + 本次上传被回滚
    assert resp.status_code == 507
    # busy_id 仍在(保护期生效)
    assert (storage.UPLOAD_DIR / busy_id).exists()
