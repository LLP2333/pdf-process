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
