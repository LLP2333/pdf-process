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
