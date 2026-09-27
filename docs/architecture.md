# 架构总览

## 一句话定位

「上传一份或多份文字型 PDF,在画布上**拖拽框选**每道题(支持左右分栏、跨页、跨试卷组题),右侧面板实时预览裁剪效果并可拖拽重排,一键导出横版 A4 PDF / 16:9 PPTX(一题一页,可选左下角署名)。」

## 目录结构

```
.
├── backend/
│   ├── app/
│   │   ├── main.py            # FastAPI 入口与路由
│   │   ├── pdf_service.py     # PyMuPDF:预览渲染 + 多文档矢量裁剪导出 PDF + 页脚署名
│   │   ├── ppt_service.py     # python-pptx:渲图后插入 16:9 PPTX
│   │   ├── schemas.py         # Pydantic 模型(请求/响应契约)
│   │   └── storage.py         # uploads/outputs 目录约定与过期清理
│   ├── tests/                 # pytest:单元 + API 集成
│   ├── requirements.txt
│   ├── pytest.ini
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── App.tsx                # 顶层状态:docs / history / selection / 导出参数
│   │   ├── api.ts                 # 唯一对接后端的位置
│   │   ├── types.ts               # EditorRegion / EditorQuestion / DocEntry / Selection
│   │   ├── editorState.ts         # 题目+区域操作、排序插入、撤销栈(纯函数 + 单测)
│   │   ├── palette.ts             # 题目循环配色(画布与面板共用)
│   │   ├── styles.css
│   │   └── components/
│   │       ├── TopBar.tsx         # 品牌 + 撤销重做 + 导出设置弹层 + 导出按钮
│   │       ├── DocumentRail.tsx   # 左栏:多文档上传/切换/移除 + Word 引导
│   │       ├── PageCanvas.tsx     # 中央画布:框选/移动/缩放/Shift 追加(Konva)
│   │       ├── QuestionPanel.tsx  # 右栏:实时缩略图 + 拖拽重排 + 排除/删除
│   │       └── UploadPanel.tsx    # 首屏多文件上传
│   ├── tests/                 # vitest:editorState / api / 组件
│   └── ...
├── desktop/                  # Windows 桌面客户端打包(launcher + PyInstaller spec)
├── docs/                     # 本目录:开发文档
├── uploads/  outputs/        # 运行时数据(gitignore)
├── .github/workflows/build-windows.yml
├── compose.yaml
└── README.md
```

## 数据流

```
用户               浏览器(React)                    FastAPI (Uvicorn)           磁盘
 │ 选择 1..N 份 PDF │                                   │                        │
 │ ───────────────▶ │ POST /api/upload(逐份)           │ 校验 → 落盘 source.pdf │
 │                  │ ◀──── UploadResponse ──────────── │ 每页 192 DPI 渲染 PNG  │
 │                  │ <img src="/api/pages/.../page_NNN.png">                    │
 │ 在画布上拖拽框选 │ editorState: questions[]          │                        │
 │ (Shift 追加区域) │  ├ EditorQuestion{regions[]}      │                        │
 │                  │  └ History{past/present/future}   │                        │
 │                  │ 右栏逐题 POST /api/preview        │ 规范化 regions →       │
 │                  │   {question(regions 带 doc_id)}   │ 去白边 → 拼接 PNG      │
 │                  │ ◀────── image/png ─────────────── │                        │
 │ 点「导出 PDF」──▶│ POST /api/export                  │ 多文档矢量裁剪 / 拼图  │
 │                  │  {format, bottom_space, auto_trim,      │ + 可选页脚署名         │
 │                  │   footer_text, questions}         │ 写 outputs/.../export.*│
 │ 浏览器自动下载 ◀ │ ◀── application/pdf | pptx ────── │                        │
```

## 关键设计决策

1. **矩形区域是唯一切分单元,一道题 = 1..N 个区域**:用户在画布上拖拽画框;每个 `Region` 自带 `(doc_id, page, x1, y1, x2, y2)`。跨页 / 左右分栏 / 跨文档组题都是"给同一道题追加一个区域"(画布上按住 Shift 拖拽),导出时区域按序纵向堆叠、各自水平居中。旧版"水平分割线"模型(整页宽、只能上下切)已废弃。
2. **坐标系**:全程使用 PDF 原始坐标(单位 pt),前端只用 `pageWidth/pageHeight` 做像素↔pt 换算,后端永不接受像素。
3. **多文档组卷**:每份上传的 PDF 独立 `doc_id`;`/api/preview`、`/api/export` 是文档无关路由,后端把请求体里引用到的所有 doc_id 逐个过白名单(`^[a-f0-9]{16}$` + 存在性),任一失效整体 404。导出产物落在第一个被引用 doc 的 outputs 目录,由 `storage.maintenance()` 统一回收。
4. **PDF 导出走矢量**:`show_pdf_page(target_rect, src_doc, page, clip=clip)`,公式 / 表格 / 图形 100% 保留原貌,一题一页,横版 A4,题区置顶、区域各自居中。
5. **自动去白边升级为 x/y 双向**:`auto_trim=true`(默认)时,对每个区域在 1x 灰度像素图上用 PIL `point(阈值).getbbox()`(C 实现)一次拿到内容最小包围盒,四周各留 2pt 安全边。框选模型下用户常框住"半栏",横向白边同样需要收紧。同一开关同时作用于 PDF / PPTX / 预览,所见即所得。旧版题目级 `trim`(二次裁剪滑块)已废弃 —— 框本身就是裁剪边界。
6. **页脚署名 `footer_text` + 字号 `footer_size`**:导出请求可选字段(文本 ≤50 字符,字号 6-24pt 默认 8);PDF 用 PyMuPDF 内置 CJK 字体 `china-s` 在每页左下角画灰字,基线固定在 `(18, H-12)`(默认 helv 不含中文字形会乱码);PPTX 加同位置文本框,高度随字号增长且底部锚定。位置固定不随题目留白变化,保证多页署名对齐、字号变大时向上生长不出界。
7. **前端状态 = `EditorQuestion[]` + 撤销栈**:`editorState.ts` 全部纯函数(增删区域 / 移动缩放 / 重排 / 排除 / 文档级联清理 / 导出前重编号),`History{past, present, future}` 存不可变快照,上限 50 步。拖动/缩放/方向键长按走 `replacePresent`(不入栈),手势结束 `commitFrom(手势前快照)`一次入栈 —— 一次拖动只占一步撤销。文档被移除时重置历史,避免 undo 复活引用已删文档的孤儿区域。
8. **新题按视觉顺序插入**:画完新框按 (文档序, 页, y, x) 找插入位,题号始终符合试卷阅读顺序;用户也可在右栏拖拽卡片手动重排,导出前 `buildExportQuestions` 统一过滤(excluded / 宽高 < 4pt / 文档已删)并把 `no` 重排为 1..N。
9. **右栏常驻实时预览(替代旧预览弹窗)**:每题卡片直接展示 `/api/preview` 的拼接 PNG,300ms 防抖 + 串行请求 + fingerprint 比对丢弃过期响应;卡片支持拖拽重排、勾选"是否导出"、删除、单击跳转画布(自动切换文档并滚动到对应页)。
10. **自动识别降级为辅助功能**:入口移到画布工具条(「自动识别(草稿)」),仅对当前文档生效;返回的 N+1 条分割线被转换成整页宽草稿题框(`draftQuestionsFromDividers`),替换"完全属于该文档"的题、保留跨文档组合题,用户在草稿框上直接拖动/缩放微调。识别不准是常态,手动框选才是主路径。
11. **Word 文档不做程序内转换**:.docx 无固定版面,服务端转换(LibreOffice)体积大、公式排版易错,且桌面版 exe 无法打包;上传界面引导用户用 Word/WPS「另存为 PDF」,保真度反而最高。
12. **无登录、无持久会话**:doc_id 即资源句柄,16 位小写 hex(64 bit 随机不可枚举),过期(默认 24h)自动清理,可通过 `EXAM_SPLITTER_RETENTION` 调整。
13. **路径遍历防护 + 配额闸门**:所有 doc_id(路由路径与请求体内)统一走白名单;上传流式写盘按 `EXAM_SPLITTER_MAX_UPLOAD_MB`(默认 64MB)实时拒绝;`uploads + outputs` 总占用按 `EXAM_SPLITTER_MAX_STORAGE_MB`(默认 2GB)做软上限,LRU 清理带 5 分钟保护期。
14. **前后端解耦,Nginx 反代统一同源**;**Windows 桌面客户端**把后端与前端 dist 跑在同一 uvicorn 进程(详见 `desktop/launcher.py`),两者均不受本轮契约变化影响(仍是 `/api/*` 相对路径)。
15. **错误返回中文**:所有用户可见错误都用 `HTTPException(detail="中文")`,前端 `api.ts` 统一抽取 `detail` 抛出;导出/上传结果用底部 toast 呈现。

## 后端模块职责

| 模块 | 职责 |
| --- | --- |
| `app.main` | FastAPI 应用、路由、请求体 doc_id 收集与校验、错误兜底,**不写业务** |
| `app.schemas` | Pydantic 请求/响应模型,**所有外部契约的唯一源**(Region / Question / ExportRequest...) |
| `app.storage` | `uploads/`、`outputs/` 路径约定 + 单文件/总容量上限 + `maintenance()` |
| `app.pdf_service` | PDF 预览渲染 + 双向去白边 + 多文档矢量裁剪输出 PDF + 页脚署名 + 单题预览 PNG + 文字层判定 / 题号自动识别 |
| `app.ppt_service` | 把 PNG 区域组装成 16:9 PPTX + 页脚文本框(依赖 `pdf_service.render_regions_to_png`) |

## 前端模块职责

| 模块 | 职责 |
| --- | --- |
| `App.tsx` | 顶层状态:`docs` / `activeDocId` / `history`(题目撤销栈)/ `selection` / `zoom` / 导出参数 / toast;全局键盘(撤销重做、Delete、方向键微调、Shift 追加模式) |
| `editorState.ts` | 纯函数状态机:画框/追加/移动/删除/重排/排除/级联清理/`buildExportQuestions`/`draftQuestionsFromDividers` + History |
| `api.ts` | 唯一对接后端的位置,所有 fetch / 错误抽取在此 |
| `palette.ts` | 题目循环配色,画布与面板共用 |
| `TopBar` | 撤销/重做按钮 + 导出设置弹层(去白边 / 题目留白滑块 / 页脚署名)+ 导出 PDF/PPTX 按钮 |
| `DocumentRail` | 多文档上传(逐份调 `/api/upload`)、切换画布文档、移除文档、Word 引导文案 |
| `PageCanvas` | 单页画布:拖拽画框(Shift=追加)、选中/移动、Transformer 八向缩放、边界 clamp;手势结束才 commit |
| `QuestionPanel` | 每题实时缩略图(防抖+fingerprint)、拖拽重排、"是否导出"勾选、删除、跳转画布 |
| `UploadPanel` | 首屏多文件上传(与 DocumentRail 共用 App 的上传逻辑) |

## 扩展点

- **OCR 走通扫描件**:在 `detect_text_layer` 返回 `is_text=False` 后串一个 OCR(如 PaddleOCR / tesseract),再走同款题号识别,前后端契约无需改动。
- **区域级旋转 / 去噪**:`Region` 可加可选 `rotate` 字段,`_normalize_regions` 统一处理。
- **导出版式**:目前固定横版 A4 / 16:9 一题一页;若要"多题一页"或竖版,只需在 `build_pdf` 的排版循环上做文章,契约不变。
