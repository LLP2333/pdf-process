"""请求/响应模型。

前端用 PDF 原始坐标系(单位 pt)描述每道题的切分:每题由若干段组成,
每段是 `(page, y1, y2)`,代表第 `page` 页上从 `y1` 到 `y2` 的整行范围。
横向默认取整页宽,因此只需要起始/结束两条水平线。
"""
from __future__ import annotations

from pydantic import BaseModel, Field


class PageInfo(BaseModel):
    """单页元信息(以 PDF 原始坐标 pt 为单位)。"""

    index: int = Field(..., description="页码,从 0 开始")
    width: float = Field(..., description="页面宽度(pt)")
    height: float = Field(..., description="页面高度(pt)")
    image_url: str = Field(..., description="预览 PNG 的相对 URL")
    image_width: int = Field(..., description="预览 PNG 像素宽")
    image_height: int = Field(..., description="预览 PNG 像素高")


class UploadResponse(BaseModel):
    doc_id: str
    filename: str
    page_count: int
    pages: list[PageInfo]


class Segment(BaseModel):
    """一道题在某一页上的纵向区间(整行宽)。"""

    page: int = Field(..., ge=0)
    y1: float = Field(..., ge=0)
    y2: float = Field(..., ge=0)


class Question(BaseModel):
    no: int = Field(..., ge=1, description="题号(1 起)")
    segments: list[Segment] = Field(..., min_length=1)


class ExportRequest(BaseModel):
    format: str = Field("pdf", pattern=r"^(pdf|pptx)$")
    margin: float = Field(28.0, ge=0, le=120, description="页面四周留白(pt)")
    auto_trim: bool = Field(
        True,
        description="是否自动去除题目内容上下的白边(默认开启)。开启时会以原 clip 范围做像素扫描,把首末非白行回算到 pt 坐标。",
    )
    questions: list[Question] = Field(..., min_length=1)


class PreviewRequest(BaseModel):
    """单题实时预览请求:与导出共用切分数据结构,差别只是仅返回一道题的 PNG。"""

    question: Question
    auto_trim: bool = Field(True, description="是否启用自动去白边")
