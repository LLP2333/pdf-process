# 架构总览

## 一句话定位

「上传一份文字型 PDF,在网页上手动给每道题画起始/结束水平线,导出一题一页的横版 A4 PDF 或 16:9 PPTX。」

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
│   │   ├── styles.css
│   │   └── components/
│   │       ├── UploadPanel.tsx
│   │       ├── PdfPage.tsx        # PDF 预览 + react-konva 起止行
│   │       ├── QuestionList.tsx   # 侧栏题目/段管理
│   │       └── ExportPanel.tsx
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
用户                浏览器(React)                Nginx              FastAPI (Uvicorn)             磁盘
 │  选择 PDF          │                              │                       │                          │
 │ ─────────────────▶ │ POST /api/upload  (FormData) │ ───────────────────▶  │ 校验 → 落盘 source.pdf   │
 │                    │                              │                       │ 每页 144 DPI 渲染为 PNG  │
 │                    │ ◀──────  UploadResponse ─────│ ◀──────────────────── │ 返回 doc_id + pages      │
 │                    │ <img src="/api/pages/.../page_NNN.png">              │                          │
 │                    │ 用户在画布上拖出 (y1, y2)    │                       │                          │
 │ 点击导出 ────────▶ │ POST /api/export/{doc_id}                            │ 按 questions 矢量裁剪    │
 │                    │   {format, margin, questions}                        │ 写 outputs/.../export.* │
 │                    │ ◀────  application/pdf | pptx ─────────────────────  │                          │
 │ 浏览器自动下载 ◀── │                              │                       │                          │
```

## 关键设计决策

1. **手动切分而非自动**:第一阶段不做题号识别,前端只承担「画两条水平线」的交互,服务端只信任前端给的 `(page, y1, y2)`。这样 UI 极简、对不同版式的试卷都通用,后续加自动识别只是叠加一个 `POST /api/auto_detect` 接口返回 questions 草稿。
2. **坐标系**:全程使用 PDF 原始坐标(单位 pt),前端只用 `pageHeight` 做一次像素↔pt 换算。后端从来不需要知道像素。
3. **PDF 导出走矢量**:沿用 PyMuPDF 的 `show_pdf_page(target_rect, src_doc, page, clip=clip)`,公式 / 表格 / 图形 100% 保留原貌,一题一页,横版 A4,题区置顶居中,下方自然留白。
4. **PPTX 导出走栅格**:python-pptx 不支持直接嵌入 PDF;每段以 220 DPI 渲染为 PNG 再插入 16:9 幻灯片。讲解投影场景足够清晰,体积可控。
5. **无登录、无持久会话**:doc_id 即资源句柄,过期(默认 24h)自动清理,可通过 `EXAM_SPLITTER_RETENTION` 调整。
6. **前后端解耦,Nginx 反代统一同源**:前端容器 80 暴露,`/api/*` 反代到后端 8000,浏览器只见同源,免 CORS 复杂度。本地开发用 Vite proxy 模拟。
7. **错误返回中文**:所有用户可见错误都用 `HTTPException(detail="中文")`,前端 `api.ts` 统一抽取 `detail` 抛出。

## 后端模块职责

| 模块 | 职责 |
| --- | --- |
| `app.main` | FastAPI 应用、路由、错误兜底,**不写业务** |
| `app.schemas` | Pydantic 请求/响应模型,**所有外部契约的唯一源** |
| `app.storage` | `uploads/`、`outputs/` 路径约定 + `maintenance()` 过期清理 |
| `app.pdf_service` | PDF 预览渲染 + 矢量裁剪输出 PDF + 渲染段为 PNG |
| `app.ppt_service` | 把 PNG 段组装成 16:9 PPTX(依赖 `pdf_service.render_segments_to_png`) |

## 前端模块职责

| 模块 | 职责 |
| --- | --- |
| `App.tsx` | 顶层状态:`doc`、`questions`、`activeQuestion/Segment`;集中处理所有变更 |
| `api.ts` | 唯一对接后端的位置,所有 fetch / 错误抽取在此 |
| `UploadPanel` | 上传交互,无业务状态 |
| `PdfPage` | 单页 PDF + Konva Stage 叠加层(起止行 + 拖拽手柄) |
| `QuestionList` | 侧栏:展示题目/段列表、新增/删除/选中 |
| `ExportPanel` | 选格式、设留白、调 API、触发浏览器下载 |

## 扩展点

- **自动识别**:把项目早期 `split_exam.analyze` 移植成 `pdf_service.auto_detect(pdf_path) -> list[Question]`,再加一个 `POST /api/auto_detect/{doc_id}` 返回草稿即可。
- **横向裁剪**:在 `Segment` 模型加可选 `x1/x2`,`_normalize_segments` 已经预留好横向取页宽的位置;前端再加两条垂直辅助线。
- **批量上传**:在 `storage` 加 `batch_id` 维度即可。
