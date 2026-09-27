"""Pydantic 模型校验测试。"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas import ExportRequest, Question, Region


def _region(**overrides) -> Region:
    """构造一个合法 Region,允许按字段覆盖以制造反例。"""
    base = {"doc_id": "0123456789abcdef", "page": 0, "x1": 0, "y1": 0, "x2": 100, "y2": 50}
    base.update(overrides)
    return Region(**base)


def test_export_format_must_be_pdf_or_pptx() -> None:
    with pytest.raises(ValidationError):
        ExportRequest(format="docx", bottom_space=10, questions=[])


def test_questions_cannot_be_empty() -> None:
    with pytest.raises(ValidationError):
        ExportRequest(format="pdf", bottom_space=10, questions=[])


def test_regions_cannot_be_empty() -> None:
    with pytest.raises(ValidationError):
        Question(no=1, regions=[])


def test_region_page_must_be_non_negative() -> None:
    with pytest.raises(ValidationError):
        _region(page=-1)


def test_region_coordinates_must_be_non_negative() -> None:
    """反例:负坐标直接被模型拒绝(clamp 只处理"超出页面",不处理负数)。"""
    with pytest.raises(ValidationError):
        _region(x1=-5)


def test_region_accepts_any_diagonal_order() -> None:
    """正例:x1>x2 / y1>y2 的对角线画框顺序是合法输入,由服务层做 min/max。"""
    region = _region(x1=200, y1=300, x2=100, y2=100)
    assert region.x1 == 200 and region.y2 == 100


@pytest.mark.parametrize("value", [-1, 81])
def test_bottom_space_bounds(value: float) -> None:
    with pytest.raises(ValidationError):
        ExportRequest(
            format="pdf",
            bottom_space=value,
            questions=[Question(no=1, regions=[_region()])],
        )


def test_auto_trim_defaults_to_true() -> None:
    """auto_trim 默认 True,前端不传时仍按"去白边"导出;footer 默认不加、字号 8pt。"""
    req = ExportRequest(
        format="pdf",
        bottom_space=5,
        questions=[Question(no=1, regions=[_region()])],
    )
    assert req.auto_trim is True
    assert req.footer_text is None
    assert req.footer_size == 8.0


def test_footer_size_bounds() -> None:
    """反例:署名字号超出 6-24pt 区间被拒绝(太小看不清,太大会压到题目内容)。"""
    for bad_size in (5, 25):
        with pytest.raises(ValidationError):
            ExportRequest(
                format="pdf",
                bottom_space=5,
                footer_size=bad_size,
                questions=[Question(no=1, regions=[_region()])],
            )


def test_footer_text_max_length_50() -> None:
    """反例:页脚署名超过 50 字符被拒绝(页脚是一行小字,不该塞正文)。"""
    with pytest.raises(ValidationError):
        ExportRequest(
            format="pdf",
            bottom_space=5,
            footer_text="很" * 51,
            questions=[Question(no=1, regions=[_region()])],
        )


def test_footer_text_accepts_chinese() -> None:
    """正例:中文署名 ≤50 字符合法。"""
    req = ExportRequest(
        format="pdf",
        bottom_space=5,
        footer_text="命题人:张老师",
        questions=[Question(no=1, regions=[_region()])],
    )
    assert req.footer_text == "命题人:张老师"
