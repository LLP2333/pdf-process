"""PDF 渲染与按用户切分方案重组导出。

- `render_preview()`:把 PDF 的每页渲染成 PNG,供前端在画布上框选题目区域。
- `build_pdf()`:按前端提交的题目-区域方案,矢量裁剪并贴到横版 A4 上,
  一题一页。沿用项目原始思路:`show_pdf_page(target, doc, page, clip=clip)`,
  公式 / 表格 / 图形 100% 保留原貌。区域可来自多份文档(跨卷组题)。
- `render_question_preview()`:把一道题(可能跨页/跨文档)纵向拼接成单张 PNG,供前端实时预览。
- `detect_text_layer()` / `auto_detect_dividers()`:基于 PDF 文字层做"扫描件 vs
  文字版"判定,并尝试识别行首题号给出分割线建议(前端转成草稿题框)。
"""
from __future__ import annotations

import re
from io import BytesIO
from pathlib import Path

import fitz  # PyMuPDF

from .schemas import DividerSuggestion, PageInfo, Question

# PDF 原始 72dpi → 约 2.7 倍清晰度。画布支持放大到 200%,144dpi 底图会糊,
# 192dpi 在清晰度与 PNG 体积之间取平衡(A4 宽 ≈ 1587px)。
PREVIEW_DPI = 192
TRIM_WHITE_THRESHOLD = 250  # 像素灰度 ≥ 阈值视为白色,反之视为有内容
TRIM_PADDING_PT = 2.0  # 自动去白边后向外补的安全边距(pt)

# 页脚署名的排版常量:左下角灰字,固定贴着纸面左下角(不随 margin 变化,
# 因为题区置顶排布,底部天然留白,固定位置能保证多页产物署名整齐一致)。
# 字号由请求的 footer_size 控制(6-24pt,默认 8)。
FOOTER_DEFAULT_FONT_SIZE = 8.0
FOOTER_MARGIN_X = 18.0
FOOTER_BASELINE_FROM_BOTTOM = 12.0
FOOTER_COLOR = (0.55, 0.55, 0.55)

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


def _open_all(doc_paths: dict[str, Path]) -> dict[str, fitz.Document]:
    """按 doc_id 批量打开多份源 PDF;任一失败时回滚关闭已打开的,避免句柄泄漏。"""
    docs: dict[str, fitz.Document] = {}
    try:
        for doc_id, path in doc_paths.items():
            docs[doc_id] = open_doc(path)
    except Exception:
        _close_all(docs)
        raise
    return docs


def _close_all(docs: dict[str, fitz.Document]) -> None:
    """关闭 `_open_all` 打开的所有文档(单个 close 失败不影响其余)。"""
    for doc in docs.values():
        try:
            doc.close()
        except Exception:  # noqa: BLE001 - 关闭失败无补救手段,继续关剩下的
            pass


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


def _content_bbox(page: fitz.Page, clip: fitz.Rect) -> fitz.Rect:
    """在给定 `clip` 内扫描像素,返回有内容的最小包围盒(PDF pt 坐标)。

    思路:用 1x zoom 灰度渲染 `clip` 区域;把"深于阈值"的像素置 255、其余置 0,
    借 PIL 的 `getbbox()`(C 实现)一次拿到 x/y 两个方向的内容边界,再回算到 pt。
    Why 双向:框选模型下用户可能框住半栏文字,横向白边同样需要收紧,
    这样导出时内容才能放到最大。
    若 clip 为空 / 全白,直接返回原范围,避免误伤。
    """
    from PIL import Image  # 局部导入:Pillow 经由 python-pptx 引入,避免顶层硬依赖

    if clip.height < 1 or clip.width < 1:
        return fitz.Rect(clip)
    matrix = fitz.Matrix(1.0, 1.0)
    mode = "L"
    try:
        pix = page.get_pixmap(matrix=matrix, clip=clip, alpha=False, colorspace=fitz.csGRAY)
    except Exception:  # noqa: BLE001 - 极少数 PyMuPDF 版本不识别灰度常量;退回 RGB
        pix = page.get_pixmap(matrix=matrix, clip=clip, alpha=False)
        mode = "RGB"
    if pix.width == 0 or pix.height == 0:
        return fitz.Rect(clip)
    img = Image.frombuffer(mode, (pix.width, pix.height), pix.samples, "raw", mode, pix.stride, 1)
    if mode != "L":
        img = img.convert("L")
    mask = img.point(lambda v: 255 if v < TRIM_WHITE_THRESHOLD else 0)
    bbox = mask.getbbox()
    if bbox is None:
        return fitz.Rect(clip)
    left, top, right, bottom = bbox  # 右/下为开区间像素坐标
    x_per_pixel = clip.width / pix.width
    y_per_pixel = clip.height / pix.height
    x0 = clip.x0 + left * x_per_pixel - TRIM_PADDING_PT
    y0 = clip.y0 + top * y_per_pixel - TRIM_PADDING_PT
    x1 = clip.x0 + right * x_per_pixel + TRIM_PADDING_PT
    y1 = clip.y0 + bottom * y_per_pixel + TRIM_PADDING_PT
    return fitz.Rect(
        max(clip.x0, x0),
        max(clip.y0, y0),
        min(clip.x1, x1),
        min(clip.y1, y1),
    )


def _normalize_regions(
    question: Question,
    docs: dict[str, fitz.Document],
    auto_trim: bool = False,
) -> list[tuple[str, int, fitz.Rect]]:
    """把用户给的 `(doc_id, page, x1, y1, x2, y2)` 规范化为可直接裁剪的矩形列表。

    流程:
    1. `doc_id` 不在 `docs` 里(理论上路由层已校验,防御性兜底)→ 丢弃;
    2. 自动 `min/max` 以兼容任意对角线画框顺序;
    3. 越界(`page` 不在 `[0, page_count)`)或宽/高 < 1pt 的区域直接丢弃;
    4. 坐标按页面边界 clamp;
    5. `auto_trim=True` 时,对每个区域做"像素扫描去白边"(x/y 双向),
       让导出的题目紧贴有内容的最小包围盒。

    Returns:
        `(doc_id, page_index, rect)` 元组列表,顺序与 `question.regions` 一致。
    """
    out: list[tuple[str, int, fitz.Rect]] = []
    for region in question.regions:
        doc = docs.get(region.doc_id)
        if doc is None:
            continue
        if region.page < 0 or region.page >= doc.page_count:
            continue
        page = doc[region.page]
        pr = page.rect
        x0 = max(pr.x0, min(region.x1, region.x2))
        x1 = min(pr.x1, max(region.x1, region.x2))
        y0 = max(pr.y0, min(region.y1, region.y2))
        y1 = min(pr.y1, max(region.y1, region.y2))
        if x1 - x0 < 1 or y1 - y0 < 1:
            continue
        rect = fitz.Rect(x0, y0, x1, y1)
        if auto_trim:
            tightened = _content_bbox(page, rect)
            if tightened.width >= 1 and tightened.height >= 1:
                rect = tightened
        out.append((region.doc_id, region.page, rect))
    return out


def _draw_pdf_footer(page: fitz.Page, text: str, font_size: float = FOOTER_DEFAULT_FONT_SIZE) -> None:
    """在页面左下角画一行灰字署名(字号可调)。

    Why 用内置 CJK 字体 `china-s`:默认 `helv` 不含中文字形,中文署名会变乱码;
    `china-s` 是 PyMuPDF 自带的 CID 字体,无需外部字体文件即可覆盖中日韩 + ASCII。
    基线固定在离页底 12pt 处:字号变大时向上生长,不会撞到纸面下缘。
    """
    page.insert_text(
        fitz.Point(FOOTER_MARGIN_X, page.rect.height - FOOTER_BASELINE_FROM_BOTTOM),
        text,
        fontsize=font_size,
        fontname="china-s",
        color=FOOTER_COLOR,
    )


def build_pdf(
    doc_paths: dict[str, Path],
    out_path: Path,
    questions: list[Question],
    margin: float,
    auto_trim: bool = True,
    footer_text: str | None = None,
    footer_size: float = FOOTER_DEFAULT_FONT_SIZE,
) -> int:
    """根据用户给的切分方案,生成一题一页的横版 A4 PDF(区域可来自多份文档)。

    实现思路:对每题先把所有区域并到「最大宽度 + 总高度」,按等比缩放贴到
    A4 横版可用区里;每个区域**各自水平居中**(窄区域不再左贴齐),
    题区整体置顶,下方留白。使用 `page.show_pdf_page(target, src, page, clip=clip)`
    做矢量裁剪,公式 / 表格 / 图形 100% 保留。

    Args:
        doc_paths: `doc_id -> 源 PDF 路径`,支持一次导出引用多份文档。
        auto_trim: 若 True,在裁剪前对每个区域做"像素扫描去白边"(x/y 双向)。
        footer_text: 可选页脚署名,每页左下角灰字。
        footer_size: 署名字号(pt),仅在 footer_text 非空时使用。

    Returns:
        实际写入的题目数(过滤掉空区域的题目后)。
    """
    docs = _open_all(doc_paths)
    out = fitz.open()
    try:
        page_rect = fitz.paper_rect("a4-l")
        page_width, page_height = page_rect.width, page_rect.height
        avail_w = page_width - 2 * margin
        avail_h = page_height - 2 * margin
        made = 0
        for q in sorted(questions, key=lambda x: x.no):
            regions = _normalize_regions(q, docs, auto_trim=auto_trim)
            if not regions:
                continue
            common_w = max(rect.width for _, _, rect in regions)
            total_h = sum(rect.height for _, _, rect in regions)
            if common_w <= 0 or total_h <= 0:
                continue
            scale = min(avail_w / common_w, avail_h / total_h)
            page = out.new_page(width=page_width, height=page_height)
            y = margin
            for doc_id, pno, clip in regions:
                tw = clip.width * scale
                th = clip.height * scale
                x_left = margin + (avail_w - tw) / 2
                target = fitz.Rect(x_left, y, x_left + tw, y + th)
                page.show_pdf_page(target, docs[doc_id], pno, clip=clip)
                y += th
            if footer_text:
                _draw_pdf_footer(page, footer_text, font_size=footer_size)
            made += 1
        if made == 0:
            # PyMuPDF 不支持保存 0 页 PDF;此时把决定权交给上层(返回 422)
            return 0
        out.save(out_path.as_posix(), deflate=True, garbage=4)
        return made
    finally:
        out.close()
        _close_all(docs)


def render_regions_to_png(
    doc_paths: dict[str, Path],
    question: Question,
    dpi: int = 220,
    auto_trim: bool = True,
) -> list[bytes]:
    """把一道题的每个区域裁剪渲染为 PNG 字节流,供 PPTX 插入图片使用。

    DPI 默认 220:在保持文字清晰的同时控制单题 PNG 大小,
    课堂投影场景完全够用。需要更高清可调高(注意 PPTX 体积线性增长)。
    `auto_trim=True` 时与 `build_pdf` 保持一致行为:每个区域贴紧内容包围盒。
    """
    images: list[bytes] = []
    docs = _open_all(doc_paths)
    try:
        zoom = dpi / 72.0
        matrix = fitz.Matrix(zoom, zoom)
        for doc_id, pno, clip in _normalize_regions(question, docs, auto_trim=auto_trim):
            pix = docs[doc_id][pno].get_pixmap(matrix=matrix, clip=clip, alpha=False)
            images.append(pix.tobytes("png"))
    finally:
        _close_all(docs)
    return images


def render_question_preview(
    doc_paths: dict[str, Path],
    question: Question,
    auto_trim: bool = True,
    dpi: int = 110,
) -> bytes | None:
    """把一道题的所有区域纵向拼接为单张 PNG,供前端题目面板实时预览。

    多区域拼接策略:以最大区域宽为画布宽,逐段在水平方向居中粘贴;
    若该题无任何有效区域(全越界 / 全空 / 去白边后归零)返回 None。
    DPI 默认 110:预览质量足够分辨字形,又能压住单张图的体积。
    """
    from PIL import Image  # 局部导入避免顶层依赖泄漏

    docs = _open_all(doc_paths)
    try:
        regions = _normalize_regions(question, docs, auto_trim=auto_trim)
        if not regions:
            return None
        zoom = dpi / 72.0
        matrix = fitz.Matrix(zoom, zoom)
        tiles: list[Image.Image] = []
        for doc_id, pno, clip in regions:
            pix = docs[doc_id][pno].get_pixmap(matrix=matrix, clip=clip, alpha=False)
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
        _close_all(docs)


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
       让 N 个题号刚好切出 N 道题;不放到文档末页是为了避免误把
       "参考答案 / 答题卡"卷入最后一题。

    返回的 list 已按 (page, y) 排序;前端把相邻两条转换成整页宽的草稿题框。
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
