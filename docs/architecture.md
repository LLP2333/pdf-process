# 架构总览

## 一句话定位

「上传一份文字型 PDF,可选择「自动识别题号」一键产出草稿分割线,在网页上单击加分割线(两条之间为一题),通过预览弹窗逐题二次裁剪上下边界(排除页眉/页码),一键导出横版 A4 PDF / 16:9 PPTX。」

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
│   ├── default.conf.template     # nginx 模板,启动时由 envsubst 注入 CLIENT_MAX_BODY_SIZE
│   └── Dockerfile
├── desktop/                  # Windows 桌面客户端打包
│   ├── launcher.py           # 启动器:uvicorn 后台线程 + 前端静态挂载 + Tk 启停窗口
│   ├── exam_splitter.spec    # PyInstaller 单文件打包配置
│   └── requirements.txt      # 打包依赖(后端运行时 + pyinstaller)
├── docs/                     # 本目录:开发文档
├── uploads/                  # 运行时上传(gitignore)
├── outputs/                  # 运行时预览 PNG + 导出产物(gitignore)
├── .github/workflows/
│   └── build-windows.yml     # CI:windows-latest 构建并发布 ExamSplitter.exe
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
5. **二次裁剪 = 题目级别 `trim: {top, bottom}` 字段(后端在 `auto_trim` 之后单独应用,跨段级联)**:在预览弹窗中,每题可对"顶部/底部"再额外裁掉若干 pt。**前端不再 mutate segments 的 y 值,而是把 top/bottom 作为 `question.trim` 字段一起上传**;后端 `_normalize_segments` 先做完 `auto_trim` 像素扫描,**之后**再对第一/最后一段应用 trim,且当某端段被吃光时剩余量会**继续吃前/后相邻段**。这样可以避免"用户调的微调量 < 自动去白边量"时被吞掉,也能让跨页题用「底部再裁」从最后一段一路吃到第一页底部的页脚("第 1 页(共 2 页)")。Adjustment 以稳定的 question id(`${prevDivId}|${nextDivId}`)存放,分割线被删时孤儿 adjustment 会被自动清理。
13. **逐题"是否导出"开关(前端纯本地状态,不进入后端契约)**:预览弹窗每张卡片头部一个复选框,默认勾选 = 导出;取消勾选 = 不导出,卡片整体灰显 + 显示"不导出"徽标。`App.excludedQuestions: Record<string, true>` **反向**记录被排除的题(以稳定 question.id 为 key),与 `adjustments` 共用孤儿清理 effect。`doExport` 先 `filter((q) => !excluded[q.id])` 再 `applyAdjustment` 再丢空段,最后 `map((q, idx) => ({...q, no: idx + 1}))` **重新连续编号**(避免后端按 `no` 排序后题号跳变);全部排除时按钮禁用 + 文字提示。这套机制留在前端是因为后端只需要"按 no 排序拿到一组要导出的题",不应当感知"原先有多少题、谁被跳过"。
6. **PPTX 导出走栅格**:python-pptx 不支持直接嵌入 PDF;每段以 220 DPI 渲染为 PNG 再插入 16:9 幻灯片。讲解投影场景足够清晰,体积可控。
7. **预览弹窗串行而非并行**:`PreviewModal` 用 200ms debounce + 串行调用 `/api/preview`,避免调滑块时把后端打趴;每次请求按 `fingerprint` 校验,过期响应丢弃。
8. **无登录、无持久会话**:doc_id 即资源句柄,16 位小写 hex(`uuid4().hex[:16]`,64 bit 随机不可枚举),过期(默认 24h)自动清理,可通过 `EXAM_SPLITTER_RETENTION` 调整。
9. **路径遍历防护 + 配额闸门**:所有 `{doc_id}` 路由开头走严格白名单 `^[a-f0-9]{16}$`,非法形式(含 `..`、URL 编码绕过等)统一 404 不区分原因。上传走流式写盘并按 `EXAM_SPLITTER_MAX_UPLOAD_MB`(默认 64MB)实时拒绝,`uploads + outputs` 总占用按 `EXAM_SPLITTER_MAX_STORAGE_MB`(默认 2GB)做软上限:超过时 `storage.maintenance()` 按 mtime 升序清掉**保护期(默认 5 分钟)以外**的旧 doc,清不下来才让本次上传 507,避免误删别人正在用的文档。
10. **前后端解耦,Nginx 反代统一同源**:前端容器 80 暴露,`/api/*` 反代到后端 8000,浏览器只见同源,免 CORS 复杂度。本地开发用 Vite proxy 模拟。`client_max_body_size` 走 `default.conf.template` + 镜像内置 envsubst,通过 compose 的 `CLIENT_MAX_BODY_SIZE` 注入,与后端 `MAX_UPLOAD_MB` 保持联动。
11. **错误返回中文**:所有用户可见错误都用 `HTTPException(detail="中文")`,前端 `api.ts` 统一抽取 `detail` 抛出。
12. **Windows 桌面客户端 = 同源单进程 exe**:`desktop/launcher.py` 把后端 `app` 与前端 `dist/` 跑在同一个 uvicorn 进程、同一端口(默认 8000,被占用则取系统空闲端口),用 `StaticFiles(html=True)` 挂到根路由 `/`。因为前端 `api.ts` 调的是相对路径 `/api/*`,同源后无需 nginx 反代即可直连。uvicorn 跑在后台线程(`install_signal_handlers` 被置空,子线程不注册信号),主线程用标准库 Tkinter 提供「打开网页 / 停止并退出」的启停界面,用户体验仍是"本地网页"。数据目录落 `%LOCALAPPDATA%\ExamSplitter`(规避 Program Files 无写权限),且必须在 `import app.main` 之前设好 `EXAM_SPLITTER_DATA_DIR`(`storage.py` 在导入时即读取)。打包由 PyInstaller(`exam_splitter.spec`,onefile + `collect_all` 收齐 uvicorn/pymupdf/pptx 等动态依赖)完成,CI 在 `windows-latest` 上先 `npm run build` 再 `pyinstaller`。

## 后端模块职责

| 模块 | 职责 |
| --- | --- |
| `app.main` | FastAPI 应用、路由、错误兜底,**不写业务** |
| `app.schemas` | Pydantic 请求/响应模型,**所有外部契约的唯一源** |
| `app.storage` | `uploads/`、`outputs/` 路径约定 + 单文件/总容量上限 + `maintenance()`(过期清理 + 超容量 LRU,带保护窗) |
| `app.pdf_service` | PDF 预览渲染 + 自动去白边 + 矢量裁剪输出 PDF + 拼接单题预览 PNG + 文字层判定 / 题号自动识别 |
| `app.ppt_service` | 把 PNG 段组装成 16:9 PPTX(依赖 `pdf_service.render_segments_to_png`) |

## 前端模块职责

| 模块 | 职责 |
| --- | --- |
| `App.tsx` | 顶层状态:`doc`、`dividers`、`autoTrim`、`margin`、`adjustments`、`excludedQuestions`、`showPreview`、`activeQuestionIndex`、`autoDetecting / autoDetectMessage` |
| `dividers.ts` | 纯函数 `buildQuestionsFromDividers`(N 条 → N-1 道题)+ `applyAdjustmentToQuestion` |
| `api.ts` | 唯一对接后端的位置,所有 fetch / 错误抽取在此 |
| `UploadPanel` | 上传交互,无业务状态 |
| `PdfPage` | 单页 PDF + Konva Stage 叠加:单击新建 / 拖动调整 / Shift单击+× 删除分割线 |
| `QuestionList` | 左栏:派生题目列表(跨页提示 + 二次裁剪角标)+ 跳转 + 清空分割线 |
| `ExportPanel` | 左栏顶部:「自动识别题号」按钮 + 结果提示 + 自动去白边 + 页边距 + 「预览裁剪效果」按钮 + 折叠左栏按钮 |
| `PreviewModal` | 弹窗:逐题预览 + 顶部/底部再裁剪滑块 + **每题"导出/不导出"复选框** + 「确认并导出 PDF/PPTX」 |

## 关键流程:自动识别题号

`POST /api/auto_detect/{doc_id}` 在 `pdf_service` 内分两步走:

1. **`detect_text_layer(pdf_path)`** —— 用 `page.get_text("text")` 取每页文字总字符数,平均 ≥ `TEXT_LAYER_MIN_CHARS_PER_PAGE`(20)才判定为文字版。扫描件每页只有零星 OCR 残片(常 < 10),会被直接判定为非文字版,前端据此提示用户回退到手动画线。
2. **`auto_detect_dividers(pdf_path)`** —— 仅在文字版上运行:
   - 用 `page.get_text("dict")` 拿到每行的 bbox 与文本;
   - 行首正则 `^\s*(\d{1,3})\s*[\.\、\)\)]\s*\S` 匹配题号(强制后面紧跟非空白字符,排除"年份"、"页码");
   - 题号必须位于页面左侧(`bbox.x0 < 页宽 * 0.5`),进一步排除右栏页码、答题卡占位等;
   - 候选按 (page, y) 排序后,跑 O(n²) DP 选出"题号差为 1 的最长升序链",过滤"选项里的 1./2."与"第 1 页"等噪音(链长 < 2 视为无效);
   - 链上每个题号上方 6pt 各画一条分割线;**末尾再加一条放在链中最后一个题号所在页底部 `height - 6pt`**,因为前端约定"两条相邻线之间为一题",N 个题号要切出 N 题需要 N+1 条线;不把分割线放到文档末页是为了避免误把"参考答案 / 答题卡"卷入最后一题。

前端 `App.handleAutoDetect`:
- 扫描件 / 无题号匹配 → 仅在 `ExportPanel` 顶部展示中文提示,不动用户已有的分割线;
- 识别成功 → 用 `setDividers([...])` 替换(并 `setAdjustments({})` 清空二次裁剪),让用户基于草稿继续手工微调。

## 扩展点

- **OCR 走通扫描件**:在 `detect_text_layer` 返回 `is_text=False` 后串一个 OCR(如 PaddleOCR / tesseract),再走 `auto_detect_dividers` 同款题号识别即可,前后端契约无需改动。
- **横向裁剪**:在 `Segment` 模型加可选 `x1/x2`,`_normalize_segments` 已经预留好横向取页宽的位置;前端再加两条垂直辅助线;预览弹窗复用滑块控件即可。
- **批量上传**:在 `storage` 加 `batch_id` 维度即可。
