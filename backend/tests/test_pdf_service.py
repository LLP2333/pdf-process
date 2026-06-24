"""pdf_service:预览渲染 + 矢量裁剪 PDF 导出。"""
from __future__ import annotations

from pathlib import Path

import fitz
import pytest

from app import pdf_service
from app.schemas import Question, QuestionTrim, Segment


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


def test_trim_applies_after_auto_trim(sample_pdf: Path) -> None:
    """关键回归:`trim` 必须在 `auto_trim` 之后生效,不能被去白边吞掉。

    构造:把 segments[0] 框成"整页"(y1=0..页高),auto_trim 必定会把它收紧到
    文字内容范围(顶部白边 → 内容起点)。如果 trim.top 与 auto_trim 串联在 clip
    层,小量 top 会被 `max(clip.y0, ty0)` 吃掉;正确实现应当让 trim 在 auto_trim
    之后再向内收一刀。"""
    doc = fitz.open(sample_pdf.as_posix())
    try:
        ph = doc[0].rect.height
        q_no_trim = Question(no=1, segments=[Segment(page=0, y1=0, y2=ph)])
        q_with_trim = Question(
            no=1,
            segments=[Segment(page=0, y1=0, y2=ph)],
            trim=QuestionTrim(top=10, bottom=15),
        )
        no_trim = pdf_service._normalize_segments(q_no_trim, doc, auto_trim=True)
        with_trim = pdf_service._normalize_segments(q_with_trim, doc, auto_trim=True)
    finally:
        doc.close()

    assert len(no_trim) == 1 and len(with_trim) == 1
    base_rect = no_trim[0][1]
    trimmed_rect = with_trim[0][1]
    # trim 永远在 auto_trim 结果之上再裁,所以差值严格 = (top + bottom)
    assert trimmed_rect.y0 == pytest.approx(base_rect.y0 + 10, rel=0, abs=1e-6)
    assert trimmed_rect.y1 == pytest.approx(base_rect.y1 - 15, rel=0, abs=1e-6)


def test_trim_applies_to_first_and_last_segments_in_cross_page(sample_pdf: Path) -> None:
    """跨两页时:top 改 segments[0],bottom 改 segments[-1],中间段不动。"""
    doc = fitz.open(sample_pdf.as_posix())
    try:
        ph0 = doc[0].rect.height
        q = Question(
            no=1,
            segments=[
                Segment(page=0, y1=200, y2=ph0),
                Segment(page=1, y1=0, y2=400),
            ],
            trim=QuestionTrim(top=20, bottom=50),
        )
        segs_no_at = pdf_service._normalize_segments(q, doc, auto_trim=False)
    finally:
        doc.close()

    assert len(segs_no_at) == 2
    first = segs_no_at[0][1]
    last = segs_no_at[1][1]
    # 第一段被 top 收紧 20pt
    assert first.y0 == pytest.approx(200 + 20)
    assert first.y1 == pytest.approx(ph0)
    # 最后一段被 bottom 收紧 50pt
    assert last.y0 == pytest.approx(0)
    assert last.y1 == pytest.approx(400 - 50)


def test_trim_top_cascades_across_segments(sample_pdf: Path) -> None:
    """top 吃完第一段后,剩余量继续吃下一段的顶部(跨段级联)。"""
    doc = fitz.open(sample_pdf.as_posix())
    try:
        q = Question(
            no=1,
            segments=[
                Segment(page=0, y1=100, y2=150),  # 高 50
                Segment(page=1, y1=0, y2=400),
            ],
            trim=QuestionTrim(top=80, bottom=0),
        )
        segs = pdf_service._normalize_segments(q, doc, auto_trim=False)
    finally:
        doc.close()

    # 第一段被完全吃掉,剩 30pt 继续吃第二段的顶部
    assert len(segs) == 1
    assert segs[0][0] == 1
    rect = segs[0][1]
    assert rect.y0 == pytest.approx(30)
    assert rect.y1 == pytest.approx(400)


def test_trim_bottom_cascades_into_first_page_footer(sample_pdf: Path) -> None:
    """关键回归(用户报的 bug 现场):跨两页题 + 大 bottom,吃完第二页那段后继续吃第一页底部。

    场景:题目跨页,segments[0] 是"第一页下半部分"(底部带"第1页(共2页)"页脚),
    segments[1] 是"第二页上半部分"。用户拖动 bottom 滑块到 200pt:第二页那一段(200pt)
    被完全吃掉,剩 0;若 bottom = 230,则吃穿第二页后还要继续从第一页底部再吃 30pt。
    """
    doc = fitz.open(sample_pdf.as_posix())
    try:
        ph0 = doc[0].rect.height
        q = Question(
            no=1,
            segments=[
                Segment(page=0, y1=300, y2=ph0),  # 第一页下半,底部带页脚
                Segment(page=1, y1=0, y2=200),  # 第二页上半,高 200
            ],
            trim=QuestionTrim(top=0, bottom=230),  # 200 + 30
        )
        segs = pdf_service._normalize_segments(q, doc, auto_trim=False)
    finally:
        doc.close()

    # 第二段被完全吃掉,剩 30pt 继续吃第一段底部
    assert len(segs) == 1
    assert segs[0][0] == 0
    rect = segs[0][1]
    assert rect.y0 == pytest.approx(300)
    assert rect.y1 == pytest.approx(ph0 - 30)


def test_trim_eats_everything_returns_empty(sample_pdf: Path) -> None:
    """trim 大到把所有段都吃光时返回空列表(由上层判 X-Empty)。"""
    doc = fitz.open(sample_pdf.as_posix())
    try:
        q = Question(
            no=1,
            segments=[
                Segment(page=0, y1=100, y2=200),  # 高 100
                Segment(page=1, y1=0, y2=100),  # 高 100
            ],
            trim=QuestionTrim(top=0, bottom=500),  # 远超 200 总高
        )
        segs = pdf_service._normalize_segments(q, doc, auto_trim=False)
    finally:
        doc.close()
    assert segs == []


# ---------------------------------------------------------------------------
# 自动识别:文字版 / 扫描件判定 + 题号识别
# ---------------------------------------------------------------------------


def _make_text_pdf_with_questions(path: Path, page_count: int = 2, per_page: int = 4) -> int:
    """在 `path` 写一份文字版试卷,每页 `per_page` 道题(题号格式 `n. xxx`)。返回总题数。"""
    doc = fitz.open()
    no = 1
    for _ in range(page_count):
        page = doc.new_page(width=595, height=842)
        # 模拟页眉(右栏 → 不会被识别为题号),验证"非左栏过滤"
        page.insert_text((480, 50), "Page 1 of 2", fontsize=10)
        for i in range(per_page):
            y = 100 + i * 160
            page.insert_text((72, y), f"{no}. body of question", fontsize=12)
            no += 1
    doc.save(path.as_posix())
    doc.close()
    return no - 1


def test_detect_text_layer_recognizes_text_pdf(sample_pdf: Path) -> None:
    """sample_pdf 每页有几十字符 → 应判定为文字版。"""
    is_text, char_count, page_count = pdf_service.detect_text_layer(sample_pdf)
    assert is_text is True
    assert page_count == 2
    assert char_count >= 2 * pdf_service.TEXT_LAYER_MIN_CHARS_PER_PAGE


def test_detect_text_layer_recognizes_scan_pdf(scan_pdf: Path) -> None:
    """扫描件(无文字层)应被判定为非文字版。"""
    is_text, char_count, page_count = pdf_service.detect_text_layer(scan_pdf)
    assert is_text is False
    assert page_count == 2
    # 极少量空白也算 0(detect_text_layer 已过滤)
    assert char_count < pdf_service.TEXT_LAYER_MIN_CHARS_PER_PAGE * page_count


def test_auto_detect_dividers_returns_n_plus_one_for_n_questions(tmp_path: Path) -> None:
    """N 道题应当得到 N+1 条分割线(N 条题首 + 1 条末题底界)。"""
    pdf_path = tmp_path / "exam.pdf"
    total = _make_text_pdf_with_questions(pdf_path, page_count=2, per_page=4)
    assert total == 8

    dividers = pdf_service.auto_detect_dividers(pdf_path)
    assert len(dividers) == total + 1

    # 按 (page, y) 升序
    keys = [(d.page, d.y) for d in dividers]
    assert keys == sorted(keys)
    # 末条放在最后一页底部附近
    last = dividers[-1]
    assert last.page == 1
    assert last.y > 800  # A4 高 842,扣 6pt 后 ≈ 836


def test_auto_detect_dividers_filters_non_question_numerics(tmp_path: Path) -> None:
    """反例:页眉里的"5", 选项里的"1." 不应破坏题号链识别。

    构造一份单页 PDF,故意混入容易误判的内容:
    - 页眉 "5/8" 在右上角(应被左栏过滤掉)
    - 题干内的 "1. 选项 A" 嵌在题 2 中间(同行非行首)
    - 真正题号 1./2./3. 在页面左侧
    应识别出 3 条题首 + 1 条末题底界 = 4 条分割线。
    """
    pdf_path = tmp_path / "noisy.pdf"
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((520, 40), "5/8", fontsize=10)  # 右栏页码,左栏过滤掉
    page.insert_text((72, 100), "1. 真题一题干", fontsize=12)
    page.insert_text((90, 130), "    选项 A 包括 1. 一类", fontsize=10)  # 行首是空格 + 内嵌"1."
    page.insert_text((72, 250), "2. 真题二题干", fontsize=12)
    page.insert_text((72, 400), "3. 真题三题干", fontsize=12)
    doc.save(pdf_path.as_posix())
    doc.close()

    dividers = pdf_service.auto_detect_dividers(pdf_path)
    assert len(dividers) == 4, f"应识别出 3 题 + 1 末界 = 4 条,实际:{dividers}"
    # 题首分割线应位于题号上方(y ≤ 题号 bbox.top)
    assert dividers[0].y < 100
    assert dividers[1].y < 250
    assert dividers[2].y < 400


def test_auto_detect_dividers_returns_empty_for_scan(scan_pdf: Path) -> None:
    """扫描件无文字层 → 收集不到题号候选 → 返回空列表。"""
    assert pdf_service.auto_detect_dividers(scan_pdf) == []


def test_auto_detect_dividers_returns_empty_when_chain_too_short(tmp_path: Path) -> None:
    """文字版但只有零星 "1." 一个题号(无 2./3./...)→ 链长 < 2,放弃。"""
    pdf_path = tmp_path / "lone.pdf"
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 100), "1. lonely question", fontsize=12)
    page.insert_text((72, 200), "no more numbers here", fontsize=12)
    doc.save(pdf_path.as_posix())
    doc.close()

    assert pdf_service.auto_detect_dividers(pdf_path) == []
