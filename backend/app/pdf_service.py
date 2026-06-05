"""PDF 渲染与按用户切分方案重组导出。

- `render_preview()`:把 PDF 的每页渲染成 PNG,供前端在画布上预览/画线。
- `build_pdf()`:按前端提交的题目-段落方案,矢量裁剪并贴到横版 A4 上,
  一题一页。沿用项目原始思路:`show_pdf_page(target, doc, page, clip=clip)`,
  公式 / 表格 / 图形 100% 保留原貌。
- `render_question_preview()`:把一道题(可能跨页)纵向拼接成单张 PNG,供前端实时预览。
"""
from __future__ import annotations

from io import BytesIO
from pathlib import Path

import fitz  # PyMuPDF

from .schemas import PageInfo, Question

PREVIEW_DPI = 144  # PDF 原始 72dpi → 2 倍清晰度,够画线交互
TRIM_WHITE_THRESHOLD = 250  # 像素灰度 ≥ 阈值视为白色,反之视为有内容
TRIM_PADDING_PT = 2.0  # 自动去白边后向外补的安全边距(pt)


def open_doc(pdf_path: Path) -> fitz.Document:
    """打开 PDF 文档。封装一层方便测试 mock 与未来切换其它后端。"""
    return fitz.open(pdf_path)


def render_preview(pdf_path: Path, image_dir: Path, image_url_prefix: str) -> list[PageInfo]:
    """逐页渲染预览 PNG 到 `image_dir`,并返回各页元信息。

    Args:
        pdf_path: 已上传的 PDF 路径(只读)。
        image_dir: 预览图输出目录,函数会自动 mkdir。
        image_url_prefix: 拼接 `image_url` 时的前缀(通常是 `/api/pages/<doc_id>`)。

    Returns:
        与 PDF 页一一对应的 `PageInfo` 列表;`index` 从 0 开始,
        `width`/`height` 以 pt 为单位(与前端画框时坐标系一致)。
    """
    image_dir.mkdir(parents=True, exist_ok=True)
    pages: list[PageInfo] = []
    doc = open_doc(pdf_path)
    try:
        zoom = PREVIEW_DPI / 72.0
        matrix = fitz.Matrix(zoom, zoom)
        for i in range(doc.page_count):
            page = doc[i]
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            out = image_dir / f"page_{i:03d}.png"
            pix.save(out.as_posix())
            pages.append(
                PageInfo(
                    index=i,
                    width=page.rect.width,
                    height=page.rect.height,
                    image_url=f"{image_url_prefix}/page_{i:03d}.png",
                    image_width=pix.width,
                    image_height=pix.height,
                )
            )
    finally:
        doc.close()
    return pages


def _content_y_range(page: fitz.Page, clip: fitz.Rect) -> tuple[float, float]:
    """在给定 `clip` 内扫描像素,返回有内容的纵向 `(y0, y1)`(PDF pt 坐标)。

    思路:用 1x zoom 灰度渲染 `clip` 区域;逐行用 `min(bytes_row)` 判定该行最深的像素
    是否低于 `TRIM_WHITE_THRESHOLD`;首末有内容行 → 回算到 pt 坐标。
    Why 取灰度而非 RGB:单通道字节流更便宜,`min()` 走 C 实现也足够快。
    若 clip 为空 / 全白,直接返回原范围,避免误伤。
    """
    if clip.height < 1 or clip.width < 1:
        return clip.y0, clip.y1
    matrix = fitz.Matrix(1.0, 1.0)
    try:
        pix = page.get_pixmap(matrix=matrix, clip=clip, alpha=False, colorspace=fitz.csGRAY)
    except Exception:  # noqa: BLE001 - 极少数 PyMuPDF 版本不识别灰度常量;退回 RGB
        pix = page.get_pixmap(matrix=matrix, clip=clip, alpha=False)
    w, h = pix.width, pix.height
    if w == 0 or h == 0:
        return clip.y0, clip.y1
    samples = pix.samples
    channels = pix.n
    top: int | None = None
    bottom: int | None = None
    stride = w * channels
    for y in range(h):
        row = samples[y * stride : (y + 1) * stride]
        # 灰度直接 min;RGB 同时考察三通道(只要任一通道偏暗即视为有内容)
        if min(row) < TRIM_WHITE_THRESHOLD:
            if top is None:
                top = y
            bottom = y
    if top is None or bottom is None:
        return clip.y0, clip.y1
    y_per_pixel = clip.height / h
    y0 = clip.y0 + top * y_per_pixel - TRIM_PADDING_PT
    y1 = clip.y0 + (bottom + 1) * y_per_pixel + TRIM_PADDING_PT
    return max(clip.y0, y0), min(clip.y1, y1)


def _normalize_segments(
    question: Question,
    doc: fitz.Document,
    auto_trim: bool = False,
) -> list[tuple[int, fitz.Rect]]:
    """把用户给的 `(page, y1, y2)` 规范化为页内 `fitz.Rect`。

    - 自动 `min/max` 以兼容 `y1 > y2` 的输入;
    - 越界(`page` 不在 `[0, page_count)`)或高度 < 1 的段直接丢弃;
    - 横向恒取整页宽(本期需求只画水平线);
    - `auto_trim=True` 时,对每段额外做一次"像素扫描去白边",
      让导出的题目紧贴有内容的最小包围盒。
    """
    out: list[tuple[int, fitz.Rect]] = []
    for seg in question.segments:
        if seg.page < 0 or seg.page >= doc.page_count:
            continue
        page = doc[seg.page]
        pr = page.rect
        y0 = max(pr.y0, min(seg.y1, seg.y2))
        y1 = min(pr.y1, max(seg.y1, seg.y2))
        if y1 - y0 < 1:
            continue
        rect = fitz.Rect(pr.x0, y0, pr.x1, y1)
        if auto_trim:
            ty0, ty1 = _content_y_range(page, rect)
            if ty1 - ty0 >= 1:
                rect = fitz.Rect(pr.x0, ty0, pr.x1, ty1)
        out.append((seg.page, rect))
    return out


def build_pdf(
    pdf_path: Path,
    out_path: Path,
    questions: list[Question],
    margin: float,
    auto_trim: bool = True,
) -> int:
    """根据用户给的切分方案,生成一题一页的横版 A4 PDF。

    实现思路:对每题先把所有段并到「共同宽度 + 总高度」,
    再按等比缩放贴到 A4 横版可用区里(题区置顶居中,下方留白)。
    使用 `page.show_pdf_page(target, src, page, clip=clip)` 做矢量裁剪,
    公式 / 表格 / 图形 100% 保留。

    Args:
        auto_trim: 若 True,在裁剪前对每段做一次"像素扫描去白边",
            让题目内容更紧凑、放大后更易看清。

    Returns:
        实际写入的题目数(过滤掉空段的题目后)。
    """
    doc = open_doc(pdf_path)
    out = fitz.open()
    try:
        page_rect = fitz.paper_rect("a4-l")
        W, H = page_rect.width, page_rect.height
        avail_w = W - 2 * margin
        avail_h = H - 2 * margin
        made = 0
        for q in sorted(questions, key=lambda x: x.no):
            segs = _normalize_segments(q, doc, auto_trim=auto_trim)
            if not segs:
                continue
            common_w = max(r.width for _, r in segs)
            total_h = sum(r.height for _, r in segs)
            if common_w <= 0 or total_h <= 0:
                continue
            scale = min(avail_w / common_w, avail_h / total_h)
            page = out.new_page(width=W, height=H)
            x_left = margin + (avail_w - common_w * scale) / 2
            y = margin
            for pno, clip in segs:
                tw = clip.width * scale
                th = clip.height * scale
                target = fitz.Rect(x_left, y, x_left + tw, y + th)
                page.show_pdf_page(target, doc, pno, clip=clip)
                y += th
            made += 1
        if made == 0:
            # PyMuPDF 不支持保存 0 页 PDF;此时把决定权交给上层(返回 422)
            return 0
        out.save(out_path.as_posix(), deflate=True, garbage=4)
        return made
    finally:
        out.close()
        doc.close()


def render_segments_to_png(
    pdf_path: Path,
    question: Question,
    dpi: int = 220,
    auto_trim: bool = True,
) -> list[bytes]:
    """把一道题的每段裁剪渲染为 PNG 字节流,供 PPTX 插入图片使用。

    DPI 默认 220:在保持文字清晰的同时控制单题 PNG 大小,
    课堂投影场景完全够用。需要更高清可调高(注意 PPTX 体积线性增长)。
    `auto_trim=True` 时与 `build_pdf` 保持一致行为:每段贴紧内容包围盒。
    """
    images: list[bytes] = []
    doc = open_doc(pdf_path)
    try:
        zoom = dpi / 72.0
        matrix = fitz.Matrix(zoom, zoom)
        for pno, clip in _normalize_segments(question, doc, auto_trim=auto_trim):
            pix = doc[pno].get_pixmap(matrix=matrix, clip=clip, alpha=False)
            images.append(pix.tobytes("png"))
    finally:
        doc.close()
    return images


def render_question_preview(
    pdf_path: Path,
    question: Question,
    auto_trim: bool = True,
    dpi: int = 110,
) -> bytes | None:
    """把一道题的所有段纵向拼接为单张 PNG,供前端右侧实时预览。

    多段拼接策略:以最大段宽为画布宽,逐段在水平方向居中粘贴;
    若该题无任何有效段(全越界 / 全空高 / 去白边后归零)返回 None。
    DPI 默认 110:预览质量足够分辨字形,又能压住单张图的体积。
    """
    from PIL import Image  # 局部导入避免顶层依赖泄漏

    doc = open_doc(pdf_path)
    try:
        segs = _normalize_segments(question, doc, auto_trim=auto_trim)
        if not segs:
            return None
        zoom = dpi / 72.0
        matrix = fitz.Matrix(zoom, zoom)
        tiles: list[Image.Image] = []
        for pno, clip in segs:
            pix = doc[pno].get_pixmap(matrix=matrix, clip=clip, alpha=False)
            tiles.append(Image.open(BytesIO(pix.tobytes("png"))).convert("RGB"))
        if not tiles:
            return None
        canvas_w = max(tile.width for tile in tiles)
        canvas_h = sum(tile.height for tile in tiles)
        canvas = Image.new("RGB", (canvas_w, canvas_h), color=(255, 255, 255))
        y = 0
        for tile in tiles:
            x = (canvas_w - tile.width) // 2
            canvas.paste(tile, (x, y))
            y += tile.height
        buf = BytesIO()
        canvas.save(buf, format="PNG", optimize=True)
        return buf.getvalue()
    finally:
        doc.close()
