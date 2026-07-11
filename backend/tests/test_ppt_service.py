"""ppt_service:PPTX 生成(矩形区域 + 页脚署名)。"""
from __future__ import annotations

from pathlib import Path

from pptx import Presentation
from pptx.util import Inches, Pt

from app import ppt_service
from app.schemas import Question, Region

DOC_A = "aaaaaaaaaaaaaaaa"


def _region(page: int, y1: float, y2: float, x1: float = 0, x2: float = 595) -> Region:
    return Region(doc_id=DOC_A, page=page, x1=x1, y1=y1, x2=x2, y2=y2)


def test_build_pptx_creates_one_slide_per_question(sample_pdf: Path, tmp_path: Path) -> None:
    out = tmp_path / "out.pptx"
    questions = [
        Question(no=1, regions=[_region(0, 120, 300)]),
        Question(no=2, regions=[_region(1, 120, 240)]),
    ]
    made = ppt_service.build_pptx({DOC_A: sample_pdf}, out, questions, margin_pt=28.0)
    assert made == 2

    prs = Presentation(out.as_posix())
    assert len(prs.slides) == 2
    # 16:9 标准尺寸
    assert prs.slide_width == Inches(13.333)
    assert prs.slide_height == Inches(7.5)
    # 每张幻灯片至少有一张图片(题区)
    for slide in prs.slides:
        assert any(shape.shape_type == 13 for shape in slide.shapes), "应至少含 1 张图片(shape_type=13)"


def test_build_pptx_skips_empty_questions(sample_pdf: Path, tmp_path: Path) -> None:
    out = tmp_path / "out.pptx"
    questions = [
        Question(no=1, regions=[_region(99, 0, 10)]),  # 全部越界
        Question(no=2, regions=[_region(0, 100, 200)]),
    ]
    made = ppt_service.build_pptx({DOC_A: sample_pdf}, out, questions, margin_pt=28.0)
    assert made == 1


def test_build_pptx_adds_footer_textbox(sample_pdf: Path, tmp_path: Path) -> None:
    """footer_text 非空时每张幻灯片左下角应有署名文本框;未传时不应出现。"""
    questions = [Question(no=1, regions=[_region(0, 120, 300)])]

    out_with = tmp_path / "with_footer.pptx"
    made = ppt_service.build_pptx(
        {DOC_A: sample_pdf}, out_with, questions, margin_pt=28.0, footer_text="命题人:张老师"
    )
    assert made == 1
    prs = Presentation(out_with.as_posix())
    texts = [
        shape.text_frame.text
        for slide in prs.slides
        for shape in slide.shapes
        if shape.has_text_frame
    ]
    assert "命题人:张老师" in texts

    out_without = tmp_path / "no_footer.pptx"
    ppt_service.build_pptx({DOC_A: sample_pdf}, out_without, questions, margin_pt=28.0)
    prs = Presentation(out_without.as_posix())
    assert all(
        not shape.has_text_frame or not shape.text_frame.text
        for slide in prs.slides
        for shape in slide.shapes
    ), "未传 footer_text 时不应有任何文本框内容"


def test_build_pptx_footer_size_controls_font_size(sample_pdf: Path, tmp_path: Path) -> None:
    """footer_size 应落到署名 run 的字号上。"""
    questions = [Question(no=1, regions=[_region(0, 120, 300)])]
    out = tmp_path / "footer_14.pptx"
    made = ppt_service.build_pptx(
        {DOC_A: sample_pdf}, out, questions, margin_pt=28.0, footer_text="张老师", footer_size=14.0
    )
    assert made == 1

    prs = Presentation(out.as_posix())
    runs = [
        run
        for slide in prs.slides
        for shape in slide.shapes
        if shape.has_text_frame
        for para in shape.text_frame.paragraphs
        for run in para.runs
        if "张老师" in run.text
    ]
    assert runs, "应能找到署名 run"
    assert runs[0].font.size == Pt(14)
