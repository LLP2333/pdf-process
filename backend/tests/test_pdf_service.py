"""pdf_service:预览渲染 + 矢量裁剪 PDF 导出。"""
from __future__ import annotations

from pathlib import Path

import fitz

from app import pdf_service
from app.schemas import Question, Segment


def test_render_preview_outputs_png_per_page(sample_pdf: Path, tmp_path: Path) -> None:
    out = tmp_path / "preview"
    pages = pdf_service.render_preview(sample_pdf, out, image_url_prefix="/api/pages/test")

    assert len(pages) == 2
    for i, p in enumerate(pages):
        assert p.index == i
        assert p.width > 0 and p.height > 0
        assert p.image_url == f"/api/pages/test/page_{i:03d}.png"
        assert (out / f"page_{i:03d}.png").exists()


def test_build_pdf_creates_one_page_per_question(sample_pdf: Path, tmp_path: Path) -> None:
    out = tmp_path / "out.pdf"
    questions = [
        Question(no=1, segments=[Segment(page=0, y1=120, y2=300)]),
        Question(no=2, segments=[Segment(page=0, y1=300, y2=500), Segment(page=1, y1=120, y2=240)]),
    ]
    made = pdf_service.build_pdf(sample_pdf, out, questions, margin=28.0)

    assert made == 2
    assert out.exists()
    doc = fitz.open(out.as_posix())
    try:
        assert doc.page_count == 2
        # A4 横版尺寸校验
        page = doc[0]
        assert page.rect.width > page.rect.height
    finally:
        doc.close()


def test_build_pdf_ignores_empty_segments(sample_pdf: Path, tmp_path: Path) -> None:
    """y1 == y2 视为空段;page 越界也应被丢弃。"""
    out = tmp_path / "out.pdf"
    questions = [
        Question(no=1, segments=[Segment(page=0, y1=200, y2=200)]),  # 空高
        Question(no=2, segments=[Segment(page=99, y1=10, y2=20)]),  # 越界
        Question(no=3, segments=[Segment(page=0, y1=100, y2=200)]),  # 正常
    ]
    made = pdf_service.build_pdf(sample_pdf, out, questions, margin=28.0)
    assert made == 1


def test_normalize_swaps_y1_y2(sample_pdf: Path) -> None:
    """允许用户传 y1 > y2,内部应自动 swap。"""
    doc = fitz.open(sample_pdf.as_posix())
    try:
        q = Question(no=1, segments=[Segment(page=0, y1=300, y2=100)])
        normalized = pdf_service._normalize_segments(q, doc)
    finally:
        doc.close()

    assert len(normalized) == 1
    _, rect = normalized[0]
    assert rect.y0 == 100
    assert rect.y1 == 300


def test_render_segments_to_png_returns_bytes(sample_pdf: Path) -> None:
    q = Question(no=1, segments=[Segment(page=0, y1=100, y2=300), Segment(page=1, y1=100, y2=200)])
    pngs = pdf_service.render_segments_to_png(sample_pdf, q)

    assert len(pngs) == 2
    for b in pngs:
        assert b.startswith(b"\x89PNG\r\n\x1a\n"), "应为 PNG 字节流"
