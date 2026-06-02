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
- `POST /api/export/{doc_id}`       按 {format, margin, questions} 矢量裁剪并下载产物
"""
from __future__ import annotations

import re
from contextlib import asynccontextmanager
from typing import AsyncIterator
from urllib.parse import quote

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from . import pdf_service, ppt_service, storage
from .schemas import ExportRequest, UploadResponse


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

    校验顺序:文件名后缀 → 文件非空 → PyMuPDF 能正常打开。
    任意一步失败都会返回带中文说明的 HTTP 错误,前端可直接展示。
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="仅支持 PDF 文件")

    doc_id = storage.new_doc_id()
    in_path = storage.upload_path(doc_id)
    in_path.parent.mkdir(parents=True, exist_ok=True)
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="空文件")
    in_path.write_bytes(data)

    image_dir = storage.output_dir(doc_id)
    image_dir.mkdir(parents=True, exist_ok=True)
    try:
        pages = pdf_service.render_preview(
            in_path,
            image_dir,
            image_url_prefix=f"/api/pages/{doc_id}",
        )
    except Exception as exc:  # noqa: BLE001 - 让前端看到具体原因
        raise HTTPException(status_code=422, detail=f"PDF 解析失败:{exc}") from exc

    storage.maintenance()
    return UploadResponse(
        doc_id=doc_id,
        filename=file.filename,
        page_count=len(pages),
        pages=pages,
    )


# 预览 PNG 文件名白名单,防止路径遍历(只允许 `page_数字.png`)。
_NAME_RE = re.compile(r"^page_\d{3}\.png$")


@app.get(
    "/api/pages/{doc_id}/{name}",
    summary="读取预览 PNG",
    description="返回上传阶段渲染的某一页 PNG,文件名需匹配 `page_<3位数>.png`。",
)
def page_image(doc_id: str, name: str) -> FileResponse:
    """读取 `outputs/<doc_id>/page_NNN.png`。命中白名单规则后再到磁盘上找。"""
    if not _NAME_RE.match(name):
        raise HTTPException(status_code=404, detail="not found")
    path = storage.output_dir(doc_id) / name
    if not path.exists():
        raise HTTPException(status_code=404, detail="not found")
    return FileResponse(path.as_posix(), media_type="image/png")


@app.post(
    "/api/export/{doc_id}",
    summary="按切分方案导出 PDF / PPTX",
    description=(
        "接收 `{format, margin, questions}`;`questions` 中每题的 `segments` 用 PDF "
        "原始坐标(pt)给出 `(page, y1, y2)`,横向默认整页宽。"
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
    - `made == 0` 视为「切分方案没有任何有效区域」(可能 y1==y2、page 越界),
      返回 422 给前端提示。
    """
    in_path = storage.upload_path(doc_id)
    if not in_path.exists():
        raise HTTPException(status_code=404, detail="文档不存在或已过期")

    if payload.format == "pdf":
        out_path = storage.export_path(doc_id, "pdf")
        try:
            made = pdf_service.build_pdf(in_path, out_path, payload.questions, payload.margin)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=f"导出 PDF 失败:{exc}") from exc
        media = "application/pdf"
        download = "试卷切割重组.pdf"
    else:
        out_path = storage.export_path(doc_id, "pptx")
        try:
            made = ppt_service.build_pptx(in_path, out_path, payload.questions, payload.margin)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=f"导出 PPTX 失败:{exc}") from exc
        media = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        download = "试卷切割重组.pptx"

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


__all__ = ["app"]
