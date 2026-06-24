"""PDF 渲染与按用户切分方案重组导出。

- `render_preview()`:把 PDF 的每页渲染成 PNG,供前端在画布上预览/画线。
- `build_pdf()`:按前端提交的题目-段落方案,矢量裁剪并贴到横版 A4 上,
  一题一页。沿用项目原始思路:`show_pdf_page(target, doc, page, clip=clip)`,
  公式 / 表格 / 图形 100% 保留原貌。
- `render_question_preview()`:把一道题(可能跨页)纵向拼接成单张 PNG,供前端实时预览。
- `detect_text_layer()` / `auto_detect_dividers()`:基于 PDF 文字层做"扫描件 vs
  文字版"判定,并尝试识别行首题号给出分割线建议。
"""
from __future__ import annotations

import re
from io import BytesIO
from pathlib import Path

import fitz  # PyMuPDF

from .schemas import DividerSuggestion, PageInfo, Question

PREVIEW_DPI = 144  # PDF 原始 72dpi → 2 倍清晰度,够画线交互
TRIM_WHITE_THRESHOLD = 250  # 像素灰度 ≥ 阈值视为白色,反之视为有内容
TRIM_PADDING_PT = 2.0  # 自动去白边后向外补的安全边距(pt)

# "可提取字符 / 页"低于此阈值,视为扫描件(没文字层或文字层稀疏到没意义)。
# 经验值:正常文字版试卷每页文字数都在数百以上,扫描件通常只有零星 OCR 残片(< 10)。
TEXT_LAYER_MIN_CHARS_PER_PAGE = 20

# 行首题号识别正则:支持 "1.", "12.", "1、", "1)", "1)" 等中国试卷常见样式。
# 故意不接受没有标点的纯数字开头,避免把"年份 2024"或"第 1 页"这种误判为题号。
_QUESTION_NUMBER_RE = re.compile(r"^\s*(\d{1,3})\s*[\.\、\)\)]\s*\S")

# 题号必须落在页面左侧才算数(右侧靠墙的"5"通常是页码或图注)。
_QUESTION_NUMBER_LEFT_RATIO = 0.5

# 自动识别后,把分割线放在"题号文字上沿"再往上 6pt,避免吃到题号本身的描边。
_AUTO_DIVIDER_TOP_PADDING = 6.0

# 文档末尾自动补的"最后一题底界",从最后一页底部往内收 6pt,排除可能的"答题卡说明"边框。
_AUTO_DIVIDER_BOTTOM_PADDING = 6.0


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

    流程:
    1. 自动 `min/max` 以兼容 `y1 > y2` 的输入;
    2. 越界(`page` 不在 `[0, page_count)`)或高度 < 1 的段直接丢弃;
    3. 横向恒取整页宽(本期需求只画水平线);
    4. `auto_trim=True` 时,对每段额外做一次"像素扫描去白边",
       让导出的题目紧贴有内容的最小包围盒;
    5. 若 `question.trim` 不为空,**在去白边之后**再应用题目级 trim
       —— `top` 收第一段上界,`bottom` 收最后一段下界。这一步必须放在最后,
       否则 `auto_trim` 会"吞掉"小于自动收紧量的 top/bottom,导致用户微调失效。
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

    trim = question.trim
    if out and trim is not None:
        # 让 trim 跨段级联:吃完当前端段后,把剩余量继续应用到相邻段。
        # 这是为了支持用户的真实诉求 —— 比如题目跨两页时,
        # 用「底部再裁」从第二页一直吃到第一页底部的页码("第1页(共2页)")。
        # 没有这个级联,bottom 调到把 segments[-1] 裁没就停了,前面那段动不了。
        if trim.top > 0:
            remain = trim.top
            while out and remain > 0:
                pno, rect = out[0]
                h = rect.y1 - rect.y0
                if remain >= h - 1:
                    remain -= h
                    out.pop(0)
                else:
                    out[0] = (pno, fitz.Rect(rect.x0, rect.y0 + remain, rect.x1, rect.y1))
                    remain = 0
        if out and trim.bottom > 0:
            remain = trim.bottom
            while out and remain > 0:
                pno, rect = out[-1]
                h = rect.y1 - rect.y0
                if remain >= h - 1:
                    remain -= h
                    out.pop()
                else:
                    out[-1] = (pno, fitz.Rect(rect.x0, rect.y0, rect.x1, rect.y1 - remain))
                    remain = 0
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


def detect_text_layer(pdf_path: Path) -> tuple[bool, int, int]:
    """判断 PDF 是否含有可用的文字层。

    Why:扫描件本质上是"每页一张大图",几乎没有可提取的字符;在它上面跑题号识别会
    100% 失败,所以应当在前端按下"自动识别"时**先**告诉用户"这是扫描件,自动识别
    用不了",而不是给一个空结果让他自己猜原因。

    Returns:
        `(is_text, total_chars, page_count)`:
        - `is_text`:每页平均可提取字符数 ≥ `TEXT_LAYER_MIN_CHARS_PER_PAGE` 时为 True;
        - `total_chars`:全文档非空白字符总数(供前端展示提示用);
        - `page_count`:页数(0 页也算扫描件,避免 ZeroDivision)。
    """
    doc = open_doc(pdf_path)
    try:
        page_count = doc.page_count
        if page_count <= 0:
            return False, 0, 0
        total_chars = 0
        for i in range(page_count):
            text = doc[i].get_text("text") or ""
            # 过滤掉空白字符(扫描件偶尔会被 OCR 蹭出几个换行/空格),避免把空白当作"有文字"
            total_chars += sum(1 for c in text if not c.isspace())
        is_text = (total_chars / page_count) >= TEXT_LAYER_MIN_CHARS_PER_PAGE
        return is_text, total_chars, page_count
    finally:
        doc.close()


def _collect_question_number_candidates(
    doc: fitz.Document,
) -> list[tuple[int, float, int]]:
    """扫描每页文字行,把"行首像题号"的位置收集成 `(page, y_top, num)` 列表。

    过滤策略(避免把"第 1 页"、"5%" 之类的噪音误识别):
    - 正则要求"数字 + . / 、 / )"且后面必须紧跟非空白字符(标准题干起始);
    - 题号必须靠左:bbox.x0 < 页宽 * 0.5(右栏的"5"通常是页码或答题卡占位);
    - 顺序按视觉顺序 (page asc, y asc) 给出,后续的"找最长升序链"就靠这个顺序工作。
    """
    candidates: list[tuple[int, float, int]] = []
    for pno in range(doc.page_count):
        page = doc[pno]
        page_w = page.rect.width
        for block in page.get_text("dict").get("blocks", []):
            # type=0 是文字块,type=1 是图片,跳过图片
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                spans = line.get("spans", [])
                if not spans:
                    continue
                text = "".join(s.get("text", "") for s in spans)
                m = _QUESTION_NUMBER_RE.match(text)
                if not m:
                    continue
                bbox = line.get("bbox") or spans[0].get("bbox")
                if not bbox:
                    continue
                if bbox[0] > page_w * _QUESTION_NUMBER_LEFT_RATIO:
                    continue
                num = int(m.group(1))
                # 题号一般 ≤ 100;太大的(年份、电话)排除掉,降低误判
                if num <= 0 or num > 200:
                    continue
                candidates.append((pno, float(bbox[1]), num))
    candidates.sort(key=lambda c: (c[0], c[1]))
    return candidates


def _longest_increasing_chain(
    candidates: list[tuple[int, float, int]],
) -> list[tuple[int, float, int]]:
    """从候选里挑出"题号差为 1 的最长递增链"。

    Why:试卷里 `数字.` 出现的不只是题号 —— 还可能是"7. 甲"这种选项、文末的
    "第 3 页"。但**真正的题号必然是 1, 2, 3, ... 一气呵成**(中间至多偶尔被分页打断,
    数字本身仍单调递增),所以"差为 1 的最长升序链"非常稳。

    实现是 O(n²) DP,试卷题号通常 < 50 个,跑得飞快;真要爆量也不会超过几百。
    """
    n = len(candidates)
    if n == 0:
        return []
    dp = [1] * n
    prev = [-1] * n
    for i in range(n):
        for j in range(i):
            if candidates[j][2] + 1 == candidates[i][2] and dp[j] + 1 > dp[i]:
                dp[i] = dp[j] + 1
                prev[i] = j
    end = max(range(n), key=lambda i: dp[i])
    if dp[end] < 2:
        # 链长 < 2 没意义(可能是误识别的孤立 "1.");直接放弃
        return []
    chain: list[tuple[int, float, int]] = []
    cur = end
    while cur != -1:
        chain.append(candidates[cur])
        cur = prev[cur]
    chain.reverse()
    return chain


def auto_detect_dividers(pdf_path: Path) -> list[DividerSuggestion]:
    """基于行首题号自动给出分割线建议(N 道题 ⇒ N+1 条分割线)。

    工作流:
    1. 收集所有"看上去像题号"的行首候选;
    2. 用最长"差为 1"递增链挑出真正的题号序列(过滤选项里的 1./2. 与页码);
    3. 链上每个题号上方 6pt 各画一条分割线作为"题目上界";
    4. **额外补一条"末题下界"**:放在链中最后一个题号所在页的底部 -6pt,
       让 N 个题号刚好切出 N 道题(否则按"两线之间一题"会少最后一题)。

    返回的 list 已按 (page, y) 排序;前端可直接为每条赋一个稳定 id。
    """
    doc = open_doc(pdf_path)
    try:
        candidates = _collect_question_number_candidates(doc)
        chain = _longest_increasing_chain(candidates)
        if not chain:
            return []

        suggestions: list[DividerSuggestion] = [
            DividerSuggestion(page=pno, y=max(0.0, y - _AUTO_DIVIDER_TOP_PADDING))
            for pno, y, _num in chain
        ]
        # 末题下界:放在最后一个题号所在页的底部留白处。
        # 选最后一个题号所在页的页底,而不是文档末页 —— 避免误把"参考答案"卷入最后一题。
        last_page_index = chain[-1][0]
        last_page_height = doc[last_page_index].rect.height
        suggestions.append(
            DividerSuggestion(
                page=last_page_index,
                y=max(0.0, last_page_height - _AUTO_DIVIDER_BOTTOM_PADDING),
            )
        )
        return suggestions
    finally:
        doc.close()
