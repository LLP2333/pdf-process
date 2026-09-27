"""pdf_service:预览渲染 + 矢量裁剪 PDF 导出(矩形区域 + 多文档)。"""
from __future__ import annotations

from pathlib import Path

import fitz
import pytest

from app import pdf_service
from app.schemas import Question, Region

DOC_A = "aaaaaaaaaaaaaaaa"
DOC_B = "bbbbbbbbbbbbbbbb"


def _region(
    page: int,
    y1: float,
    y2: float,
    x1: float = 0,
    x2: float = 595,
    doc_id: str = DOC_A,
) -> Region:
    """构造 Region 的快捷方式;默认整页宽 + DOC_A,便于逐字段覆盖。"""
    return Region(doc_id=doc_id, page=page, x1=x1, y1=y1, x2=x2, y2=y2)


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
        Question(no=1, regions=[_region(0, 120, 300)]),
        Question(no=2, regions=[_region(0, 300, 500), _region(1, 120, 240)]),
    ]
    made = pdf_service.build_pdf({DOC_A: sample_pdf}, out, questions, bottom_space=5.0)

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


def test_build_pdf_bottom_space_reserves_lower_part(sample_pdf: Path, tmp_path: Path) -> None:
    """题目留白 50%:高度受限的整页题目应被压缩到页面上半部分,下半部分空白。"""
    out = tmp_path / "out.pdf"
    questions = [Question(no=1, regions=[_region(0, 0, 842)])]
    pdf_service.build_pdf({DOC_A: sample_pdf}, out, questions, bottom_space=50.0, auto_trim=False)

    doc = fitz.open(out.as_posix())
    try:
        page = doc[0]
        bottoms = [b[3] for b in page.get_text("blocks")]
        assert bottoms
        assert max(bottoms) <= page.rect.height * 0.5 + 1
    finally:
        doc.close()


def test_build_pdf_ignores_empty_regions(sample_pdf: Path, tmp_path: Path) -> None:
    """高度 < 1pt 视为空区域;page 越界、doc_id 未知也应被丢弃。"""
    out = tmp_path / "out.pdf"
    questions = [
        Question(no=1, regions=[_region(0, 200, 200)]),  # 空高
        Question(no=2, regions=[_region(99, 10, 20)]),  # page 越界
        Question(no=3, regions=[_region(0, 10, 20, doc_id="ffffffffffffffff")]),  # doc 未知
        Question(no=4, regions=[_region(0, 100, 200)]),  # 正常
    ]
    made = pdf_service.build_pdf({DOC_A: sample_pdf}, out, questions, bottom_space=5.0)
    assert made == 1


def test_build_pdf_combines_regions_from_two_docs(
    sample_pdf: Path, second_pdf: Path, tmp_path: Path
) -> None:
    """多文档组题:一道题引用两份文档的区域,输出单页应同时含两份文档的文字。"""
    out = tmp_path / "out.pdf"
    questions = [
        Question(
            no=1,
            regions=[
                _region(0, 60, 120, doc_id=DOC_A),  # sample_pdf 首行标题区域
                _region(0, 60, 130, doc_id=DOC_B),  # second_pdf 标记文字区域
            ],
        ),
    ]
    made = pdf_service.build_pdf(
        {DOC_A: sample_pdf, DOC_B: second_pdf}, out, questions, bottom_space=5.0, auto_trim=False
    )
    assert made == 1

    doc = fitz.open(out.as_posix())
    try:
        text = doc[0].get_text("text")
    finally:
        doc.close()
    assert "Page 1 Title" in text, "应包含第一份文档的文字"
    assert "SECOND-DOC" in text, "应包含第二份文档的文字"


def test_normalize_swaps_diagonal_coordinates(sample_pdf: Path) -> None:
    """允许用户从任意对角画框(x1>x2、y1>y2),内部应自动 swap。"""
    doc = fitz.open(sample_pdf.as_posix())
    try:
        q = Question(no=1, regions=[_region(0, 300, 100, x1=400, x2=80)])
        normalized = pdf_service._normalize_regions(q, {DOC_A: doc})
    finally:
        doc.close()

    assert len(normalized) == 1
    _, _, rect = normalized[0]
    assert rect.x0 == 80
    assert rect.x1 == 400
    assert rect.y0 == 100
    assert rect.y1 == 300


def test_normalize_clamps_to_page_bounds(sample_pdf: Path) -> None:
    """超出页面(x2/y2 越过右/下边界)的坐标应被 clamp 而不是判无效。"""
    doc = fitz.open(sample_pdf.as_posix())
    try:
        page_rect = doc[0].rect
        q = Question(no=1, regions=[_region(0, 700, 9000, x1=100, x2=9000)])
        normalized = pdf_service._normalize_regions(q, {DOC_A: doc})
    finally:
        doc.close()

    assert len(normalized) == 1
    _, _, rect = normalized[0]
    assert rect.x1 == page_rect.x1
    assert rect.y1 == page_rect.y1


def test_render_regions_to_png_returns_bytes(sample_pdf: Path) -> None:
    q = Question(no=1, regions=[_region(0, 100, 300), _region(1, 100, 200)])
    pngs = pdf_service.render_regions_to_png({DOC_A: sample_pdf}, q)

    assert len(pngs) == 2
    for b in pngs:
        assert b.startswith(b"\x89PNG\r\n\x1a\n"), "应为 PNG 字节流"


def test_auto_trim_shrinks_region_in_both_directions(sample_pdf: Path) -> None:
    """auto_trim=True 时,把整页框进去也会贴紧内容包围盒 —— 纵向与横向都收紧。

    sample_pdf 的内容横向在 72..520pt 之间,纵向从 80pt 起,
    因此四个方向都应严格向内收。
    """
    doc = fitz.open(sample_pdf.as_posix())
    try:
        page_rect = doc[0].rect
        q = Question(no=1, regions=[_region(0, 0, page_rect.height, x1=0, x2=page_rect.width)])
        raw = pdf_service._normalize_regions(q, {DOC_A: doc}, auto_trim=False)
        trimmed = pdf_service._normalize_regions(q, {DOC_A: doc}, auto_trim=True)
    finally:
        doc.close()

    assert len(raw) == 1 and len(trimmed) == 1
    raw_rect = raw[0][2]
    trim_rect = trimmed[0][2]
    assert trim_rect.height < raw_rect.height
    assert trim_rect.width < raw_rect.width
    assert trim_rect.y0 > raw_rect.y0
    assert trim_rect.y1 < raw_rect.y1
    assert trim_rect.x0 > raw_rect.x0
    assert trim_rect.x1 < raw_rect.x1
    # 内容起点约在 (72, 80),留 2pt 安全边距后应落在其附近
    assert trim_rect.x0 == pytest.approx(70, abs=6)
    assert trim_rect.y0 == pytest.approx(66, abs=12)


def test_content_bbox_keeps_clip_when_all_white(sample_pdf: Path) -> None:
    """反例:全白区域去白边应返回原 clip,避免把空白题整没。"""
    doc = fitz.open(sample_pdf.as_posix())
    try:
        # sample_pdf 顶部 0-60pt 不含任何内容(文字从 y=80 开始)
        clip = fitz.Rect(0, 0, doc[0].rect.width, 60)
        bbox = pdf_service._content_bbox(doc[0], clip)
    finally:
        doc.close()

    assert bbox == clip


def test_horizontal_clip_excludes_content_outside_x_range(sample_pdf: Path, tmp_path: Path) -> None:
    """横向裁剪必须真实生效:x 范围只框住左侧空白(0..60pt)时,导出不应带出任何文字。"""
    out_blank = tmp_path / "blank.pdf"
    out_text = tmp_path / "text.pdf"
    # sample_pdf 文字从 x=72 起;0..60 是纯左边距
    blank_q = [Question(no=1, regions=[_region(0, 100, 300, x1=0, x2=60)])]
    text_q = [Question(no=1, regions=[_region(0, 100, 300, x1=0, x2=595)])]

    assert pdf_service.build_pdf({DOC_A: sample_pdf}, out_blank, blank_q, bottom_space=5.0, auto_trim=False) == 1
    assert pdf_service.build_pdf({DOC_A: sample_pdf}, out_text, text_q, bottom_space=5.0, auto_trim=False) == 1

    doc_blank = fitz.open(out_blank.as_posix())
    doc_text = fitz.open(out_text.as_posix())
    try:
        assert doc_blank[0].get_text("text").strip() == "", "x 裁剪应把文字排除在外"
        assert "Question line" in doc_text[0].get_text("text"), "整页宽时文字应保留"
    finally:
        doc_blank.close()
        doc_text.close()


def test_build_pdf_renders_footer_text(sample_pdf: Path, tmp_path: Path) -> None:
    """footer_text 非空时,每页左下角应有署名文字;未传时不应出现。"""
    questions = [
        Question(no=1, regions=[_region(0, 120, 300)]),
        Question(no=2, regions=[_region(1, 120, 240)]),
    ]

    out_with = tmp_path / "with_footer.pdf"
    made = pdf_service.build_pdf(
        {DOC_A: sample_pdf}, out_with, questions, bottom_space=5.0, footer_text="命题人:张老师"
    )
    assert made == 2
    doc = fitz.open(out_with.as_posix())
    try:
        for page in doc:
            assert "命题人:张老师" in page.get_text("text"), "每页都应带页脚署名"
    finally:
        doc.close()

    out_without = tmp_path / "no_footer.pdf"
    pdf_service.build_pdf({DOC_A: sample_pdf}, out_without, questions, bottom_space=5.0)
    doc = fitz.open(out_without.as_posix())
    try:
        assert "命题人" not in doc[0].get_text("text")
    finally:
        doc.close()


def test_build_pdf_footer_size_controls_font_size(sample_pdf: Path, tmp_path: Path) -> None:
    """footer_size 应真实落到渲染字号上(从文字层 span 反查 size)。"""
    questions = [Question(no=1, regions=[_region(0, 120, 300)])]
    out = tmp_path / "footer_14.pdf"
    made = pdf_service.build_pdf(
        {DOC_A: sample_pdf}, out, questions, bottom_space=5.0, footer_text="张老师", footer_size=14.0
    )
    assert made == 1

    doc = fitz.open(out.as_posix())
    try:
        spans = [
            span
            for block in doc[0].get_text("dict")["blocks"]
            if block.get("type") == 0
            for line in block.get("lines", [])
            for span in line.get("spans", [])
            if "张老师" in span.get("text", "")
        ]
    finally:
        doc.close()
    assert spans, "应能在文字层找到署名 span"
    assert spans[0]["size"] == pytest.approx(14.0, abs=0.5)


def test_render_question_preview_returns_single_png(sample_pdf: Path, second_pdf: Path) -> None:
    """跨页 + 跨文档的一题应当被纵向拼接为一张 PNG。"""
    q = Question(
        no=1,
        regions=[
            _region(0, 120, 300, doc_id=DOC_A),
            _region(0, 60, 130, doc_id=DOC_B),
        ],
    )
    png = pdf_service.render_question_preview(
        {DOC_A: sample_pdf, DOC_B: second_pdf}, q, auto_trim=True
    )
    assert png is not None
    assert png.startswith(b"\x89PNG\r\n\x1a\n")


def test_render_question_preview_returns_none_when_invalid(sample_pdf: Path) -> None:
    """所有区域越界 / 空高时返回 None。"""
    q = Question(no=1, regions=[_region(99, 0, 10)])
    assert pdf_service.render_question_preview({DOC_A: sample_pdf}, q) is None


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
