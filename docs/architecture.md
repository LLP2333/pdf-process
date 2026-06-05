# 架构总览

## 一句话定位

「上传一份文字型 PDF,在网页上单击加分割线(两条之间为一题),通过预览弹窗逐题二次裁剪上下边界(排除页眉/页码),一键导出横版 A4 PDF / 16:9 PPTX。」

## 目录结构

```
.
├── backend/
│   ├── app/
│   │   ├── main.py            # FastAPI 入口与路由
│   │   ├── pdf_service.py     # PyMuPDF:预览渲染 + 矢量裁剪导出 PDF
│   │   ├── ppt_service.py     # python-pptx:渲图后插入 16:9 PPTX
│   │   ├── schemas.py         # Pydantic 模型(请求/响应契约)
│   │   └── storage.py         # uploads/outputs 目录约定与过期清理
│   ├── tests/                 # pytest:单元 + API 集成
│   ├── requirements.txt
│   ├── pytest.ini
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── api.ts
│   │   ├── types.ts               # Divider / DerivedQuestion / Adjustment
│   │   ├── dividers.ts            # 分割线 → 题目派生 + 二次裁剪应用(纯函数 + 单测)
│   │   ├── styles.css
│   │   └── components/
│   │       ├── UploadPanel.tsx
│   │       ├── PdfPage.tsx        # PDF 单击/拖动/Shift单击/X 删除分割线
│   │       ├── QuestionList.tsx   # 左栏:派生题目列表(只读)
│   │       ├── ExportPanel.tsx    # 左栏顶部:自动去白边 + 页边距 + 打开预览
│   │       └── PreviewModal.tsx   # 弹窗:逐题预览 + 顶部/底部再裁剪 + 直接导出
│   ├── tests/                 # vitest:api 与组件
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── nginx.conf
│   └── Dockerfile
├── docs/                     # 本目录:开发文档
├── uploads/                  # 运行时上传(gitignore)
├── outputs/                  # 运行时预览 PNG + 导出产物(gitignore)
├── compose.yaml
└── README.md
```

## 数据流

```
用户              浏览器(React)                  FastAPI (Uvicorn)             磁盘
 │  选择 PDF       │                                  │                          │
 │ ──────────────▶ │ POST /api/upload                 │ 校验 → 落盘 source.pdf   │
 │                 │                                  │ 每页 144 DPI 渲染 PNG    │
 │                 │ ◀───── UploadResponse ────────── │ 返回 doc_id + pages      │
 │                 │ <img src="/api/pages/.../page_NNN.png">                     │
 │                 │ 用户在画布上单击/拖动分割线      │                          │
 │                 │ dividers → DerivedQuestion[]     │                          │
 │                 │ (相邻两条之间;首末以外被忽略)   │                          │
 │ 点「预览」───▶ │ PreviewModal 打开                │                          │
 │                 │ 逐题 POST /api/preview/{doc_id}  │ 应用 top/bottom 微裁后   │
 │                 │   {question(已应用 adj),         │ 去白边 + 拼接 PNG        │
 │                 │    auto_trim}                    │                          │
 │                 │ ◀────── image/png ────────────── │                          │
 │ 调整滑块 ─────▶ │ 重新 POST /api/preview ─────────▶│                          │
 │ 确认导出 ─────▶ │ POST /api/export/{doc_id}        │ 矢量裁剪 / 16:9 拼图     │
 │                 │   {format, margin, auto_trim,    │ 写 outputs/.../export.*  │
 │                 │    questions(已应用 adj)}        │                          │
 │ 浏览器自动下载◀ │ ◀── application/pdf | pptx ───── │                          │
```

## 关键设计决策

1. **分割线为唯一交互单元 + 两条分割线之间为一道题**:用户在 PDF 上单击加水平分割线;按 `(page, y)` 排序后,**每两条相邻分割线之间**就是一题。第一条分割线以上、最后一条分割线以下的内容会被自动忽略,这样用户可以直接用"两端的分割线"去掉页眉/页脚/页码。N 条线 ⇒ N-1 道题;前端不维护题号,完全由分割线推导。
2. **坐标系**:全程使用 PDF 原始坐标(单位 pt),前端只用 `pageHeight` 做一次像素↔pt 换算。后端从来不需要知道像素。
3. **PDF 导出走矢量**:沿用 PyMuPDF 的 `show_pdf_page(target_rect, src_doc, page, clip=clip)`,公式 / 表格 / 图形 100% 保留原貌,一题一页,横版 A4,题区置顶居中。
4. **自动去白边**:`auto_trim=true`(默认)时,对每段在 1x 灰度像素图上逐行扫描,找出首末非白行回算到 pt 坐标。同一开关同时作用于矢量 PDF 导出、PPTX 导出与预览,确保所见即所得。
5. **二次裁剪 = 题目级别 top/bottom 微调**:在预览弹窗中,每题可对 segments 的"顶部/底部"再额外裁掉若干 pt。前端在调用 `/api/preview` 和 `/api/export` 之前先把这两个量应用到 segments(改第一段 y1、最后一段 y2),后端不感知该字段。Adjustment 以稳定的 question id(`${prevDivId}|${nextDivId}`)存放,分割线被删时孤儿 adjustment 会被自动清理。
6. **PPTX 导出走栅格**:python-pptx 不支持直接嵌入 PDF;每段以 220 DPI 渲染为 PNG 再插入 16:9 幻灯片。讲解投影场景足够清晰,体积可控。
7. **预览弹窗串行而非并行**:`PreviewModal` 用 200ms debounce + 串行调用 `/api/preview`,避免调滑块时把后端打趴;每次请求按 `fingerprint` 校验,过期响应丢弃。
8. **无登录、无持久会话**:doc_id 即资源句柄,过期(默认 24h)自动清理,可通过 `EXAM_SPLITTER_RETENTION` 调整。
9. **前后端解耦,Nginx 反代统一同源**:前端容器 80 暴露,`/api/*` 反代到后端 8000,浏览器只见同源,免 CORS 复杂度。本地开发用 Vite proxy 模拟。
10. **错误返回中文**:所有用户可见错误都用 `HTTPException(detail="中文")`,前端 `api.ts` 统一抽取 `detail` 抛出。

## 后端模块职责

| 模块 | 职责 |
| --- | --- |
| `app.main` | FastAPI 应用、路由、错误兜底,**不写业务** |
| `app.schemas` | Pydantic 请求/响应模型,**所有外部契约的唯一源** |
| `app.storage` | `uploads/`、`outputs/` 路径约定 + `maintenance()` 过期清理 |
| `app.pdf_service` | PDF 预览渲染 + 自动去白边 + 矢量裁剪输出 PDF + 拼接单题预览 PNG |
| `app.ppt_service` | 把 PNG 段组装成 16:9 PPTX(依赖 `pdf_service.render_segments_to_png`) |

## 前端模块职责

| 模块 | 职责 |
| --- | --- |
| `App.tsx` | 顶层状态:`doc`、`dividers`、`autoTrim`、`margin`、`adjustments`、`showPreview`、`activeQuestionIndex` |
| `dividers.ts` | 纯函数 `buildQuestionsFromDividers`(N 条 → N-1 道题)+ `applyAdjustmentToQuestion` |
| `api.ts` | 唯一对接后端的位置,所有 fetch / 错误抽取在此 |
| `UploadPanel` | 上传交互,无业务状态 |
| `PdfPage` | 单页 PDF + Konva Stage 叠加:单击新建 / 拖动调整 / Shift单击+× 删除分割线 |
| `QuestionList` | 左栏:派生题目列表(跨页提示 + 二次裁剪角标)+ 跳转 + 清空分割线 |
| `ExportPanel` | 左栏顶部:自动去白边 + 页边距 + 「预览裁剪效果」按钮 |
| `PreviewModal` | 弹窗:逐题预览 + 顶部/底部再裁剪滑块 + 「确认并导出 PDF/PPTX」 |

## 扩展点

- **自动识别**:把项目早期 `split_exam.analyze` 移植成 `pdf_service.auto_detect(pdf_path) -> list[Divider]`,再加一个 `POST /api/auto_detect/{doc_id}` 返回草稿分割线即可。
- **横向裁剪**:在 `Segment` 模型加可选 `x1/x2`,`_normalize_segments` 已经预留好横向取页宽的位置;前端再加两条垂直辅助线;预览弹窗复用滑块控件即可。
- **批量上传**:在 `storage` 加 `batch_id` 维度即可。
