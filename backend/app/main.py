"""试卷切割重组 —— FastAPI 后端入口。

设计原则:
- 一切 PDF 渲染、矢量裁剪、PPTX 生成都委托给 `pdf_service` / `ppt_service`,
  本模块只负责 HTTP 接入、参数校验、错误兜底与文件下载头。
- 不依赖任何全局会话,文档以 `doc_id` (16 进制 16 字节) 唯一标识,
  上传/导出文件全部落到 `storage.BASE_DIR` 下的目录,过期由 `storage.maintenance()` 清理。

路由总览:
- `GET  /api/health`               健康检查
- `POST /api/upload`               上传 PDF,返回 doc_id 与每页预览 PNG 的 URL / 尺寸
- `GET  /api/pages/{doc_id}/{name}` 静态返回上一接口产生的预览 PNG
- `POST /api/preview/{doc_id}`     单题实时预览(纵向拼接成单张 PNG)
- `POST /api/export/{doc_id}`       按 {format, margin, auto_trim, questions} 矢量裁剪并下载产物
- `POST /api/auto_detect/{doc_id}`  判定文字版 / 扫描件,顺带尝试识别题号给出草稿分割线
"""
from __future__ import annotations

import re
import shutil
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator
from urllib.parse import quote

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response

from . import pdf_service, ppt_service, storage
from .schemas import AutoDetectResponse, ExportRequest, PreviewRequest, UploadResponse

# doc_id 严格白名单:必须是 `new_doc_id()` 生成的 16 位小写 hex,任何其它形式一律按"未找到"处理。
# 这样可以阻止 `../`、绝对路径、过长字符串等路径遍历尝试,
# 同时不向调用方泄露"非法路径"与"过期文档"的差异。
_DOC_ID_RE = re.compile(r"^[a-f0-9]{16}$")

# 上传分块大小,1MB 比较稳:既能尽早触达上限拒绝,也不会让 I/O 太碎。
_UPLOAD_CHUNK = 1024 * 1024


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """应用生命周期钩子:启动时确保数据目录存在并做一次过期清理。"""
    storage.ensure_dirs()
    storage.maintenance()
    yield


app = FastAPI(
    title="Exam Splitter API",
    description="把整张试卷按题号切成「一题一页」的后端服务。",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get(
    "/api/health",
    summary="健康检查",
    description="供反向代理 / 编排平台探活使用,固定返回 `{\"status\":\"ok\"}`。",
)
def health() -> dict[str, str]:
    """返回服务存活状态。"""
    return {"status": "ok"}


@app.post(
    "/api/upload",
    response_model=UploadResponse,
    summary="上传 PDF 并生成预览",
    description=(
        "接收一份 PDF,落盘到 `uploads/<doc_id>/source.pdf`,"
        "并逐页用 PyMuPDF 渲染成 PNG(供前端 Konva 叠加画线)。"
        "返回 `doc_id`、文件名、页数,以及每页的尺寸与预览 PNG 的 URL。"
    ),
)
async def upload(file: UploadFile = File(...)) -> UploadResponse:
    """上传 PDF 文件并立即解析为可预览的页图。

    校验顺序:文件名后缀 → 流式写入(超 `MAX_UPLOAD_BYTES` 立刻 413) → 文件非空
    → PyMuPDF 能正常打开 → 软上限校验(超 `MAX_STORAGE_BYTES` 时先 LRU 清理,清不下来则 507)。
    任意一步失败都会返回带中文说明的 HTTP 错误,前端可直接展示。
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="仅支持 PDF 文件")

    # 写之前先腾空间(过期清理 + 超容量 LRU),减少新文件被立刻拒绝的概率
    storage.maintenance()

    doc_id = storage.new_doc_id()
    in_path = storage.upload_path(doc_id)
    in_path.parent.mkdir(parents=True, exist_ok=True)

    size = 0
    try:
        with in_path.open("wb") as f:
            while True:
                chunk = await file.read(_UPLOAD_CHUNK)
                if not chunk:
                    break
                size += len(chunk)
                if size > storage.MAX_UPLOAD_BYTES:
                    # 立刻丢半成品,避免攻击者刻意发超大流量塞满磁盘
                    f.close()
                    shutil.rmtree(in_path.parent, ignore_errors=True)
                    mb = storage.MAX_UPLOAD_BYTES // (1024 * 1024)
                    raise HTTPException(
                        status_code=413, detail=f"文件过大,单文件上限 {mb} MB"
                    )
                f.write(chunk)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        shutil.rmtree(in_path.parent, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"写入文件失败:{exc}") from exc

    if size == 0:
        shutil.rmtree(in_path.parent, ignore_errors=True)
        raise HTTPException(status_code=400, detail="空文件")

    image_dir = storage.output_dir(doc_id)
    image_dir.mkdir(parents=True, exist_ok=True)
    try:
        pages = pdf_service.render_preview(
            in_path,
            image_dir,
            image_url_prefix=f"/api/pages/{doc_id}",
        )
    except Exception as exc:  # noqa: BLE001 - 让前端看到具体原因
        # 解析失败必须把半成品一并清掉,不留垃圾
        shutil.rmtree(in_path.parent, ignore_errors=True)
        shutil.rmtree(image_dir, ignore_errors=True)
        raise HTTPException(status_code=422, detail=f"PDF 解析失败:{exc}") from exc

    # 软上限兜底:这次上传把总占用顶过软上限,先 LRU 清一轮;清不下来就回滚返回 507
    if storage.storage_usage_bytes() > storage.MAX_STORAGE_BYTES:
        storage.maintenance()
        if storage.storage_usage_bytes() > storage.MAX_STORAGE_BYTES:
            shutil.rmtree(in_path.parent, ignore_errors=True)
            shutil.rmtree(image_dir, ignore_errors=True)
            mb = storage.MAX_STORAGE_BYTES // (1024 * 1024)
            raise HTTPException(
                status_code=507, detail=f"存储空间不足,请稍后再试(总上限 {mb} MB)"
            )

    return UploadResponse(
        doc_id=doc_id,
        filename=file.filename,
        page_count=len(pages),
        pages=pages,
    )


# 文件名里对各操作系统 / HTTP 头有害的字符,导出前一律剔除,避免下载报错或路径遍历。
_BAD_NAME_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def _download_name(source_name: str | None, ext: str) -> str:
    """根据上传时的原始文件名拼出下载名:`<去扩展名的原名>_切割重组.<ext>`。

    - 只取路径最后一段并去掉 `.pdf` 扩展名,挡掉 `../` 与 Windows 反斜杠路径;
    - 剔除对文件名/响应头有害的字符;
    - 主干为空(未传 source_name 或清洗后啥都不剩)时回退到固定名 `试卷切割重组.<ext>`,
      保证下载到的文件始终有个可读的名字。
    """
    stem = ""
    if source_name:
        base = source_name.replace("\\", "/").split("/")[-1].strip()
        if base[-4:].lower() == ".pdf":
            base = base[:-4]
        stem = _BAD_NAME_CHARS.sub("", base).strip()
    if not stem:
        return f"试卷切割重组.{ext}"
    return f"{stem}_切割重组.{ext}"


def _require_doc(doc_id: str) -> Path:
    """统一的 doc_id 安全闸:格式不合法 / 源文件不存在 → 统一 404。

    用单一错误码避免攻击者通过响应差异区分"路径非法"与"已过期"。
    """
    if not _DOC_ID_RE.match(doc_id):
        raise HTTPException(status_code=404, detail="文档不存在或已过期")
    in_path = storage.upload_path(doc_id)
    if not in_path.exists():
        raise HTTPException(status_code=404, detail="文档不存在或已过期")
    return in_path


# 预览 PNG 文件名白名单,防止路径遍历(只允许 `page_数字.png`)。
_NAME_RE = re.compile(r"^page_\d{3}\.png$")


@app.get(
    "/api/pages/{doc_id}/{name}",
    summary="读取预览 PNG",
    description="返回上传阶段渲染的某一页 PNG,文件名需匹配 `page_<3位数>.png`。",
)
def page_image(doc_id: str, name: str) -> FileResponse:
    """读取 `outputs/<doc_id>/page_NNN.png`。命中双白名单(doc_id + name)后再到磁盘上找。"""
    if not _DOC_ID_RE.match(doc_id) or not _NAME_RE.match(name):
        raise HTTPException(status_code=404, detail="not found")
    path = storage.output_dir(doc_id) / name
    if not path.exists():
        raise HTTPException(status_code=404, detail="not found")
    return FileResponse(path.as_posix(), media_type="image/png")


@app.post(
    "/api/preview/{doc_id}",
    summary="单题实时预览(返回 PNG)",
    description=(
        "前端在 PDF 上调整分割线时,会以此接口拉取每道题的纵向拼接预览图。"
        "请求体 `{question, auto_trim}`,响应 `image/png`,响应头 `X-Empty: 1` 标示该题无有效区域。"
    ),
    responses={
        200: {"description": "返回预览 PNG"},
        404: {"description": "doc_id 不存在或已过期"},
    },
)
def preview(doc_id: str, payload: PreviewRequest) -> Response:
    """渲染单题预览。返回 1x1 透明 PNG 时附带 `X-Empty: 1`,前端据此显示空态。"""
    in_path = _require_doc(doc_id)
    try:
        png = pdf_service.render_question_preview(
            in_path, payload.question, auto_trim=payload.auto_trim
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"生成预览失败:{exc}") from exc
    if not png:
        # 用最小占位 PNG + X-Empty 标志位告诉前端「这题没东西」,避免 4xx 报警
        empty = (
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
            b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xcf"
            b"\xc0\xf0\x1f\x00\x05\x00\x01\xff\xfe\xb7\xc2\x1a\x00\x00\x00\x00IEND\xaeB`\x82"
        )
        return Response(content=empty, media_type="image/png", headers={"X-Empty": "1"})
    return Response(content=png, media_type="image/png")


@app.post(
    "/api/export/{doc_id}",
    summary="按切分方案导出 PDF / PPTX",
    description=(
        "接收 `{format, margin, auto_trim, questions}`;`questions` 中每题的 `segments` 用 PDF "
        "原始坐标(pt)给出 `(page, y1, y2)`,横向默认整页宽。"
        "`auto_trim=true` 时,后端会在裁剪前对每段做像素扫描去掉上下白边。"
        "返回:`application/pdf` 或 PPTX 二进制,响应头含 `X-Question-Count` "
        "标示成功生成的题目数,且 `Content-Disposition` 使用 RFC 5987 编码。"
    ),
    responses={
        200: {"description": "导出成功,返回文件流"},
        404: {"description": "doc_id 不存在或已过期"},
        422: {"description": "切分方案为空或无效"},
        500: {"description": "服务器内部异常"},
    },
)
def export(doc_id: str, payload: ExportRequest) -> FileResponse:
    """根据用户给定的切分方案导出 PDF 或 PPTX。

    - `format == "pdf"`:走 PyMuPDF 的 `show_pdf_page(... clip=...)` 矢量裁剪,
      产物保留公式 / 表格 / 图形原貌,一题一页(横版 A4)。
    - `format == "pptx"`:把每段以 220 DPI 渲染为 PNG 后插入 16:9 幻灯片,
      题区置顶居中,下方留白方便讲解书写。
    - `auto_trim`:开启后逐段去除上下白边,题目内容会被放大到可用区,适合课堂投影。
    - `made == 0` 视为「切分方案没有任何有效区域」(可能 y1==y2、page 越界),
      返回 422 给前端提示。
    """
    in_path = _require_doc(doc_id)

    if payload.format == "pdf":
        out_path = storage.export_path(doc_id, "pdf")
        try:
            made = pdf_service.build_pdf(
                in_path, out_path, payload.questions, payload.margin, auto_trim=payload.auto_trim
            )
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=f"导出 PDF 失败:{exc}") from exc
        media = "application/pdf"
        download = _download_name(payload.source_name, "pdf")
    else:
        out_path = storage.export_path(doc_id, "pptx")
        try:
            made = ppt_service.build_pptx(
                in_path, out_path, payload.questions, payload.margin, auto_trim=payload.auto_trim
            )
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=f"导出 PPTX 失败:{exc}") from exc
        media = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        download = _download_name(payload.source_name, "pptx")

    if made == 0:
        raise HTTPException(status_code=422, detail="没有可导出的题目,请检查切分区域")

    return FileResponse(
        out_path.as_posix(),
        media_type=media,
        filename=download,
        headers={
            # RFC 5987:中文文件名走 UTF-8'' 编码,兼容主流浏览器
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(download)}",
            "X-Question-Count": str(made),
        },
    )


@app.post(
    "/api/auto_detect/{doc_id}",
    response_model=AutoDetectResponse,
    summary="自动识别题号并给出草稿分割线",
    description=(
        "根据 PDF 的文字层做两件事:1) 判断是否文字版(扫描件 / 加密件没文字层时无法识别);"
        "2) 文字版时按「行首题号」(如 `1.`、`2、`、`3)`)推出每道题的上界,再补一条「末题下界」,"
        "返回 N+1 条分割线,前端可直接替换当前画面上的分割线。"
        "扫描件 / 无题号匹配 / 题号链 < 2 时,`dividers` 返回空数组,`message` 给出中文提示。"
    ),
    responses={
        200: {"description": "返回判定结果与候选分割线"},
        404: {"description": "doc_id 不存在或已过期"},
    },
)
def auto_detect(doc_id: str) -> AutoDetectResponse:
    """读取已上传的 PDF,做「扫描件 vs 文字版」判定 + 题号识别。

    - 扫描件(文字层稀疏):返回 `is_text=False`,提示用户回退到手动画线;
    - 文字版但找不到稳定的题号链(< 2 个):返回空 dividers + 解释性 message;
    - 文字版且识别到 N 题:返回 N+1 条分割线(N 条题首 + 1 条末题底界)。
    """
    in_path = _require_doc(doc_id)
    try:
        is_text, char_count, page_count = pdf_service.detect_text_layer(in_path)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"读取 PDF 失败:{exc}") from exc

    if not is_text:
        return AutoDetectResponse(
            is_text=False,
            page_count=page_count,
            char_count=char_count,
            dividers=[],
            message="该 PDF 似乎是扫描件(无文字层),无法自动识别题号,请手动添加分割线。",
        )

    try:
        dividers = pdf_service.auto_detect_dividers(in_path)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"自动识别失败:{exc}") from exc

    if not dividers:
        return AutoDetectResponse(
            is_text=True,
            page_count=page_count,
            char_count=char_count,
            dividers=[],
            message="文档是文字版,但未能识别到稳定的题号序列,请手动添加分割线。",
        )

    # N+1 条分割线 = N 道题(每两条相邻线之间一题)
    question_count = max(0, len(dividers) - 1)
    return AutoDetectResponse(
        is_text=True,
        page_count=page_count,
        char_count=char_count,
        dividers=dividers,
        message=f"已自动识别到 {question_count} 道题,可在 PDF 上微调或删除分割线。",
    )


__all__ = ["app"]
