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


def test_auto_trim_shrinks_segment_to_content(sample_pdf: Path) -> None:
    """auto_trim=True 时,即便用户把整页都框进去,实际裁剪框也会贴紧内容上下界。"""
    doc = fitz.open(sample_pdf.as_posix())
    try:
        page_height = doc[0].rect.height
        # 圈一个把首行文字也包进去的大范围 (页面里文字从 y=80 开始)
        q = Question(no=1, segments=[Segment(page=0, y1=0, y2=page_height)])
        raw = pdf_service._normalize_segments(q, doc, auto_trim=False)
        trimmed = pdf_service._normalize_segments(q, doc, auto_trim=True)
    finally:
        doc.close()

    assert len(raw) == 1 and len(trimmed) == 1
    raw_rect = raw[0][1]
    trim_rect = trimmed[0][1]
    # 去白边后高度严格变小,且内容包围盒上下被收紧
    assert trim_rect.height < raw_rect.height
    assert trim_rect.y0 > raw_rect.y0
    assert trim_rect.y1 < raw_rect.y1


def test_auto_trim_keeps_clip_when_all_white(sample_pdf: Path) -> None:
    """全白区域去白边会得到 (y0,y1) == 原范围,避免把空白题整没。"""
    doc = fitz.open(sample_pdf.as_posix())
    try:
        # sample_pdf 顶部 0-70pt 不含任何内容(文字从 y=80 开始)
        clip = fitz.Rect(0, 0, doc[0].rect.width, 60)
        y0, y1 = pdf_service._content_y_range(doc[0], clip)
    finally:
        doc.close()

    assert (y0, y1) == (clip.y0, clip.y1)


def test_render_question_preview_returns_single_png(sample_pdf: Path) -> None:
    """跨页一题应当被纵向拼接为一张 PNG。"""
    q = Question(
        no=1,
        segments=[Segment(page=0, y1=120, y2=300), Segment(page=1, y1=120, y2=240)],
    )
    png = pdf_service.render_question_preview(sample_pdf, q, auto_trim=True)
    assert png is not None
    assert png.startswith(b"\x89PNG\r\n\x1a\n")


def test_render_question_preview_returns_none_when_invalid(sample_pdf: Path) -> None:
    """所有段越界 / 空高时返回 None。"""
    q = Question(no=1, segments=[Segment(page=99, y1=0, y2=10)])
    assert pdf_service.render_question_preview(sample_pdf, q) is None
