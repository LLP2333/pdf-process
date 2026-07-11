"""按题目-区域方案生成 PPTX:每题一张 16:9 幻灯片,题区图片置顶,下方留白。

PPTX 不直接支持矢量 PDF 嵌入,这里把每个区域先用 PyMuPDF 高 DPI 渲染成 PNG
再插入,几何与原 PDF 完全一致,清晰度对于讲解投影完全够用。
区域可来自多份文档(跨卷组题),与 `pdf_service.build_pdf` 共用同一套契约。
"""
from __future__ import annotations

from io import BytesIO
from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.text import MSO_ANCHOR
from pptx.util import Emu, Inches, Pt

from . import pdf_service
from .schemas import Question

# 16:9 标准尺寸(英寸)
SLIDE_W_IN = 13.333
SLIDE_H_IN = 7.5

# 页脚署名排版:左下角灰字,与 PDF 导出的视觉位置保持一致(18pt ≈ 0.25in);
# 字号由请求的 footer_size 控制(6-24pt,默认 8)。
FOOTER_LEFT_IN = 0.25
FOOTER_WIDTH_IN = 6.0
FOOTER_DEFAULT_FONT_PT = 8.0
FOOTER_COLOR = RGBColor(0x8C, 0x8C, 0x8C)


def _emu(inches: float) -> Emu:
    return Inches(inches)


def _add_footer(slide, text: str, font_size_pt: float = FOOTER_DEFAULT_FONT_PT) -> None:
    """在幻灯片左下角加一行灰字署名文本框(字号可调)。

    文本框高度随字号增长(1.6 倍行高),并把文字锚在框底部,
    这样不管字号多大,署名的"底边"都稳定贴在幻灯片左下角。
    """
    height_in = max(0.3, font_size_pt * 1.6 / 72.0)
    box = slide.shapes.add_textbox(
        _emu(FOOTER_LEFT_IN),
        _emu(SLIDE_H_IN - height_in),
        _emu(FOOTER_WIDTH_IN),
        _emu(height_in),
    )
    frame = box.text_frame
    frame.text = text
    frame.vertical_anchor = MSO_ANCHOR.BOTTOM
    run = frame.paragraphs[0].runs[0]
    run.font.size = Pt(font_size_pt)
    run.font.color.rgb = FOOTER_COLOR


def build_pptx(
    doc_paths: dict[str, Path],
    out_path: Path,
    questions: list[Question],
    margin_pt: float,
    auto_trim: bool = True,
    footer_text: str | None = None,
    footer_size: float = FOOTER_DEFAULT_FONT_PT,
) -> int:
    """生成一题一张幻灯片的 16:9 PPTX。

    Args:
        doc_paths: `doc_id -> 源 PDF 路径`,支持一次导出引用多份文档。
        out_path: 目标 PPTX,父目录会自动创建。
        questions: 用户给的切分方案(`no` + 多区域)。
        margin_pt: 每张幻灯片四周留白(pt),与 PDF 导出共用同一参数。
            内部按 1in = 72pt 换算为英寸。
        auto_trim: 是否自动去除区域四周白边(与 PDF 导出共用同一开关)。
        footer_text: 可选页脚署名,每张幻灯片左下角灰字。
        footer_size: 署名字号(pt),仅在 footer_text 非空时使用。

    Returns:
        成功生成的幻灯片数(过滤掉空区域题目后)。
    """
    prs = Presentation()
    prs.slide_width = _emu(SLIDE_W_IN)
    prs.slide_height = _emu(SLIDE_H_IN)
    blank_layout = prs.slide_layouts[6]  # 空白版式

    # 把 PDF 用 pt 表示的留白换算到英寸(1in = 72pt)
    margin_in = margin_pt / 72.0
    avail_w_in = SLIDE_W_IN - 2 * margin_in
    avail_h_in = SLIDE_H_IN - 2 * margin_in

    made = 0
    for q in sorted(questions, key=lambda x: x.no):
        pngs = pdf_service.render_regions_to_png(doc_paths, q, auto_trim=auto_trim)
        if not pngs:
            continue

        from PIL import Image  # 局部导入:Pillow 是 python-pptx 的依赖,已可用

        imgs = [Image.open(BytesIO(b)) for b in pngs]
        # 以最宽区域定统一缩放比(所有区域同 DPI 渲染,像素比例即几何比例),
        # 再按可用高做二次约束;每个区域按各自宽度水平居中,窄区域不再被拉伸。
        max_w_px = max(im.width for im in imgs)
        total_h_px = sum(im.height for im in imgs)
        scale_in_per_px = avail_w_in / max_w_px
        if total_h_px * scale_in_per_px > avail_h_in:
            scale_in_per_px = avail_h_in / total_h_px

        slide = prs.slides.add_slide(blank_layout)
        y_in = margin_in
        for png, im in zip(pngs, imgs):
            w_in = im.width * scale_in_per_px
            h_in = im.height * scale_in_per_px
            x_in = margin_in + (avail_w_in - w_in) / 2
            slide.shapes.add_picture(
                BytesIO(png),
                _emu(x_in),
                _emu(y_in),
                width=_emu(w_in),
                height=_emu(h_in),
            )
            y_in += h_in
        if footer_text:
            _add_footer(slide, footer_text, font_size_pt=footer_size)
        made += 1

    if made == 0:
        return 0
    out_path.parent.mkdir(parents=True, exist_ok=True)
    prs.save(out_path.as_posix())
    return made
