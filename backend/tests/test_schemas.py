"""Pydantic 模型校验测试。"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas import ExportRequest, Question, Segment


def test_export_format_must_be_pdf_or_pptx() -> None:
    with pytest.raises(ValidationError):
        ExportRequest(format="docx", margin=10, questions=[])


def test_questions_cannot_be_empty() -> None:
    with pytest.raises(ValidationError):
        ExportRequest(format="pdf", margin=10, questions=[])


def test_segments_cannot_be_empty() -> None:
    with pytest.raises(ValidationError):
        Question(no=1, segments=[])


def test_segment_page_must_be_non_negative() -> None:
    with pytest.raises(ValidationError):
        Segment(page=-1, y1=0, y2=10)


def test_margin_bounds() -> None:
    with pytest.raises(ValidationError):
        ExportRequest(
            format="pdf",
            margin=999,
            questions=[Question(no=1, segments=[Segment(page=0, y1=0, y2=10)])],
        )


def test_auto_trim_defaults_to_true() -> None:
    """auto_trim 是新加字段,默认 True,前端不传时仍按"去白边"导出。"""
    req = ExportRequest(
        format="pdf",
        margin=28,
        questions=[Question(no=1, segments=[Segment(page=0, y1=0, y2=10)])],
    )
    assert req.auto_trim is True
