"""请求/响应模型。

坐标契约:前端用 PDF 原始坐标系(单位 pt)描述每道题的切分。
每题由 1..N 个矩形区域(`Region`)组成,每个区域是某份文档某一页上的
`(x1, y1, x2, y2)` 矩形;区域自带 `doc_id`,因此一道题可以跨页、跨栏、
甚至跨多份上传的文档自由组合。导出时区域按列表顺序纵向堆叠。
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


class Region(BaseModel):
    """一道题在某份文档某一页上的矩形裁剪区域(pt)。

    - `doc_id` 让区域可以指向任意一份已上传的文档(多文档组题的基础);
    - `x1/y1/x2/y2` 允许任意对角线顺序,后端会自动 `min/max` 规范化,
      并按页面边界 clamp。宽或高不足 1pt 的区域视为无效被丢弃。
    """

    doc_id: str = Field(..., description="所属文档 ID(16 位小写 hex)")
    page: int = Field(..., ge=0, description="页码,从 0 开始")
    x1: float = Field(..., ge=0, description="矩形一角 x(pt)")
    y1: float = Field(..., ge=0, description="矩形一角 y(pt)")
    x2: float = Field(..., ge=0, description="矩形对角 x(pt)")
    y2: float = Field(..., ge=0, description="矩形对角 y(pt)")


class Question(BaseModel):
    no: int = Field(..., ge=1, description="题号(1 起),导出时按此排序")
    regions: list[Region] = Field(..., min_length=1, description="区域按序纵向堆叠")


class ExportRequest(BaseModel):
    format: str = Field("pdf", pattern=r"^(pdf|pptx)$")
    margin: float = Field(28.0, ge=0, le=120, description="页面四周留白(pt)")
    auto_trim: bool = Field(
        True,
        description="是否自动去除每个区域四周的白边(像素扫描内容包围盒,默认开启)。",
    )
    footer_text: str | None = Field(
        default=None,
        max_length=50,
        description="可选的页脚署名:导出的每页/每张幻灯片左下角以小号灰字呈现;留空则不加。",
    )
    footer_size: float = Field(
        default=8.0,
        ge=6,
        le=24,
        description="页脚署名字号(pt),仅在 footer_text 非空时生效;默认 8pt。",
    )
    source_name: str | None = Field(
        default=None,
        description=(
            "上传时的原始文件名(可含 .pdf 扩展名)。后端据此拼出下载名 `<原名>_切割重组.<ext>`;"
            "未传或为空时回退到固定名 `试卷切割重组.<ext>`。"
        ),
    )
    questions: list[Question] = Field(..., min_length=1)


class PreviewRequest(BaseModel):
    """单题实时预览请求:与导出共用切分数据结构,差别只是仅返回一道题的 PNG。"""

    question: Question
    auto_trim: bool = Field(True, description="是否启用自动去白边")


class DividerSuggestion(BaseModel):
    """自动识别给出的"草稿分割线",仅含位置信息。

    前端会把相邻两条线之间的整页宽范围转成矩形草稿框,供用户手动微调。
    """

    page: int = Field(..., ge=0, description="所在页(0 起)")
    y: float = Field(..., ge=0, description="纵坐标(pt,PDF 原始坐标)")


class AutoDetectResponse(BaseModel):
    """`POST /api/auto_detect/{doc_id}` 的响应。

    前端先看 `is_text`:False 时给"扫描件无法自动识别"的提示;
    True 时把 `dividers` 两两配对转换成整页宽的草稿题框。
    """

    is_text: bool = Field(..., description="是否文字版 PDF(每页可提取字符数足够多)")
    page_count: int = Field(..., ge=0, description="页数")
    char_count: int = Field(..., ge=0, description="文档可提取非空白字符总数")
    dividers: list[DividerSuggestion] = Field(
        default_factory=list,
        description="自动识别出的题号 + 末题下界生成的分割线;扫描件或无题号时为空",
    )
    message: str = Field(
        ...,
        description=(
            "面向用户的中文提示:扫描件 / 文字版但未识别到题号 / 文字版识别到 N 题。"
            "前端可直接展示。"
        ),
    )
