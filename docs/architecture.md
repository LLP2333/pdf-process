# 架构总览

## 一句话定位

「上传一份文字型 PDF,在网页上单击加分割线把试卷切成一题一段,右侧实时预览每题,导出一题一页的横版 A4 PDF 或 16:9 PPTX(可选自动去白边)。」

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
│   │   ├── types.ts
│   │   ├── dividers.ts            # 分割线 → 题目派生(纯函数 + 单测)
│   │   ├── styles.css
│   │   └── components/
│   │       ├── UploadPanel.tsx
│   │       ├── PdfPage.tsx        # PDF 单击/拖动/Shift单击/X 删除分割线
│   │       ├── QuestionList.tsx   # 左栏:派生题目列表(只读)
│   │       ├── ExportPanel.tsx    # 左栏顶部:自动去白边 + 留白 + 导出
│   │       └── PreviewPanel.tsx   # 右栏:逐题实时拼接预览
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
 │                 │ 前端 dividers → questions(纯函数)│                          │
 │                 │ POST /api/preview/{doc_id}       │ 单题去白边 + 拼接 PNG    │
 │                 │ ◀────── image/png ────────────── │ (debounce 串行调用)     │
 │ 点击导出 ─────▶ │ POST /api/export/{doc_id}        │ questions + auto_trim →  │
 │                 │   {format, margin, auto_trim,    │ 矢量裁剪 / 16:9 拼图     │
 │                 │    questions}                    │ 写 outputs/.../export.*  │
 │                 │ ◀── application/pdf | pptx ───── │                          │
 │ 浏览器自动下载◀ │                                  │                          │
```

## 关键设计决策

1. **分割线为唯一交互单元**:用户不直接「画段」,而是在 PDF 上加水平分割线;前端按 `(page, y)` 排序后,把"文档首/末隐式边界 + 用户分割线"两两组成一道题,跨页时自动拆为多段。这样的好处是:一题边界即下一题边界,绝不会出现重叠/漏切;前端不维护题号,完全由分割线推导。
2. **坐标系**:全程使用 PDF 原始坐标(单位 pt),前端只用 `pageHeight` 做一次像素↔pt 换算。后端从来不需要知道像素。
3. **PDF 导出走矢量**:沿用 PyMuPDF 的 `show_pdf_page(target_rect, src_doc, page, clip=clip)`,公式 / 表格 / 图形 100% 保留原貌,一题一页,横版 A4,题区置顶居中。
4. **自动去白边**:`auto_trim=true`(默认)时,对每段在 1x 灰度像素图上逐行扫描,找出首末非白行回算到 pt 坐标。同一开关同时作用于矢量 PDF 导出、PPTX 导出与实时预览,确保所见即所得。
5. **PPTX 导出走栅格**:python-pptx 不支持直接嵌入 PDF;每段以 220 DPI 渲染为 PNG 再插入 16:9 幻灯片。讲解投影场景足够清晰,体积可控。
6. **实时预览串行而非并行**:右侧 PreviewPanel 用 250ms debounce + 串行调用 `/api/preview`,避免拖动分割线时瞬时大量并发把后端打趴;过期请求按 `fingerprint` 丢弃。
7. **无登录、无持久会话**:doc_id 即资源句柄,过期(默认 24h)自动清理,可通过 `EXAM_SPLITTER_RETENTION` 调整。
8. **前后端解耦,Nginx 反代统一同源**:前端容器 80 暴露,`/api/*` 反代到后端 8000,浏览器只见同源,免 CORS 复杂度。本地开发用 Vite proxy 模拟。
9. **错误返回中文**:所有用户可见错误都用 `HTTPException(detail="中文")`,前端 `api.ts` 统一抽取 `detail` 抛出。

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
| `App.tsx` | 顶层状态:`doc`、`dividers`、`autoTrim`、`activeQuestionIndex`;由 dividers 派生 questions 集中分发 |
| `dividers.ts` | 纯函数 `buildQuestionsFromDividers`:把分割线集合 → 题目 + 段(跨页拆分) |
| `api.ts` | 唯一对接后端的位置,所有 fetch / 错误抽取在此 |
| `UploadPanel` | 上传交互,无业务状态 |
| `PdfPage` | 单页 PDF + Konva Stage 叠加:单击新建 / 拖动调整 / Shift单击+× 删除分割线 |
| `QuestionList` | 左栏:派生题目列表 + 跳转 + 清空分割线 |
| `ExportPanel` | 左栏顶部:自动去白边 + 留白 + 导出 PDF/PPTX |
| `PreviewPanel` | 右栏:逐题串行调用 `/api/preview`,实时缩略 + 错误兜底 |

## 扩展点

- **自动识别**:把项目早期 `split_exam.analyze` 移植成 `pdf_service.auto_detect(pdf_path) -> list[Divider]`,再加一个 `POST /api/auto_detect/{doc_id}` 返回草稿分割线即可。
- **横向裁剪**:在 `Segment` 模型加可选 `x1/x2`,`_normalize_segments` 已经预留好横向取页宽的位置;前端再加两条垂直辅助线。
- **批量上传**:在 `storage` 加 `batch_id` 维度即可。
