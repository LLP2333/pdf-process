# 变更日志

> 倒序排列,每次代码改动都要在顶部追加一行(日期 + 简述)。  
> 体量较大的改动建议附 commit / PR 链接。

## 2026-06-05 (傍晚 2)

- **修复 bug:跨页题用「底部再裁」碰到第一页页脚("第 1 页(共 2 页)")就拉不动**。
  原实现 trim 只对 `segments[-1]` 单点应用,吃完最后一段就停;但跨页题的页脚在
  `segments[0]` 末尾,根本碰不到。
  - 后端 `_normalize_segments` 改为 **跨段级联**:`bottom` 吃完最后一段后剩余量
    继续吃前一段,`top` 同理向后累积。
  - 前端 `PreviewModal` 的 `AdjustRow` 滑块上限从 120 提到 1000,数字框上限从
    500 提到 2000;另外 `value > slider_max` 时滑块显示截断到 max,但数字框保留
    真实值,避免拖动滑块时反向回弹。
  - 新增 3 条后端测试:top 跨段、bottom 吃穿后吃第一页页脚(用户报的现场)、全段被吃光返回空。

## 2026-06-05 (傍晚)

- **修复 bug:跨页题的「顶部再裁」/「底部再裁」会被 `auto_trim` 吞掉**。
  原实现在前端就把 `top/bottom` 直接加到 segments 的 `y1/y2` 上,导致后端的
  `_content_y_range` 像素扫描结果 `max(clip.y0, ty0)` / `min(clip.y1, ty1)`
  把"用户调的量 < 自动去白边量"的部分整段吃掉,**视觉上调了等于没调**(尤其是
  跨页题的顶部,因为 segments[0] 的上边界往往恰好落在页面白边里)。
  - 新增 `QuestionTrim` 资源模型;`Question` 多一个可选 `trim: { top, bottom }` 字段。
  - 后端 `_normalize_segments` 改为:**先**对每段做 `auto_trim`,**再**对第一/
    最后一段单独应用 `trim.top` / `trim.bottom`。trim 永远是最后一刀,不会被吞。
  - 前端 `applyAdjustmentToQuestion` 不再 mutate `segments`,改为把 `top/bottom`
    挂到 `question.trim` 上发出去。过度裁剪的丢弃逻辑统一交后端 `_normalize_segments`。
  - 新增后端测试 3 个:trim 在 auto_trim 之后生效、跨页 top/bottom 各自落到第一/
    最后一段、过度裁剪丢弃整段;前端 dividers / PreviewModal 测试更新到新契约。

## 2026-06-05 (下午)

- **修复语义 bug**:`buildQuestionsFromDividers` 不再把文档首末视为隐式边界。
  现在 N 条分割线产生 **N-1 道题**(且至少需要 2 条),第一条线以上、最后一条线以下的内容
  会被自动忽略 —— 用户可借此排除页眉 / 页脚 / 页码。
- **预览改为弹窗 + 二次裁剪**:
  - 移除右侧 `PreviewPanel`,改回两列布局。
  - 导出面板挂上「预览裁剪效果」按钮,点开 `PreviewModal`:逐题展示拼接 PNG,
    每张图下方有「顶部再裁(pt)」「底部再裁(pt)」两个滑块 + 数字输入,
    实时刷新该题预览;弹窗底部直接「确认并导出 PDF / PPTX」。
  - `App` 增加 `adjustments: Record<questionId, {top,bottom}>` state;
    每道派生题目带稳定 `id = ${prevDivId}|${nextDivId}`,二次裁剪能跨编辑保留,
    分割线被删时孤儿 adjustments 会被清理。
  - `applyAdjustmentToQuestion`:把 top/bottom 加到第一/末段的 y1/y2;过度裁剪时丢弃越界段。
- 文案微调:
  - 「页面留白(pt)」→「页边距(pt)」,加 tooltip 解释。
  - `QuestionList` 题目卡片「N 段」→「跨 N 页(pX,pY)」或「第 N 页」更直观;有二次裁剪显示 ✎ 角标。
- 测试:前端 +8 用例(`dividers` 推导新语义 + `applyAdjustmentToQuestion` + `PreviewModal` 5 个);
  共 **前端 33 passed / 后端 30 passed**。

## 2026-06-05

- 交互模型重构:从「画起止行」改为「单击加分割线」。
  - 前端数据模型由 `Question[]` 改为 `Divider[]`,新增 `src/dividers.ts` 把分割线推导为题目(跨页拆段);相邻分割线之间即一道题,文档首末为隐式边界。
  - `PdfPage` 重写:单击空白处 = 新建分割线、拖动 = 调整 y、Shift+单击线 = 删除、× 按钮 = 删除;选中题目时在 PDF 上叠加绿色高亮。
  - 新增 `PreviewPanel` 右栏:debounce + 串行调用 `/api/preview/{doc_id}` 拉取每题拼接预览 PNG,实时呈现导出效果。
  - 导出面板移到左栏顶部,新增「自动去除题目上下白边」复选框(默认开启)。
- 后端:
  - `pdf_service` 新增 `_content_y_range` 像素扫描去白边、`render_question_preview` 单题拼接预览;`_normalize_segments` / `build_pdf` / `render_segments_to_png` / `build_pptx` 全部支持 `auto_trim` 开关。
  - `schemas` 新增 `PreviewRequest`,`ExportRequest` 增加 `auto_trim: bool = True`。
  - `main` 新增 `POST /api/preview/{doc_id}`,无效题返回 1x1 占位 PNG + `X-Empty: 1`。
- 样式:`.app` 用 `height: 100%` 修复整页溢出导致的滚动失效;`.workspace` 改三列布局(左:导出+题目 / 中:PDF / 右:预览),窄屏自动降级隐藏预览栏。
- 测试:后端 +6 用例(去白边正反例 + 预览接口 3 个 + schemas 默认值),共 30 passed;前端 +10 用例(`dividers` 7 个 + `PreviewPanel` 4 个 + ExportPanel/QuestionList 适配),共 25 passed。
- 文档:`docs/api.md` 补 `PreviewRequest` / 预览路由 / `auto_trim` 字段;`docs/architecture.md` 同步模块与设计决策。

## 2026-06-02

- 目录上提(三):
  - 把原 `exam-splitter/` 下所有内容上提到仓库根,删除外层包装目录与外层旧 `.git`(待重建)。
  - `.cursor/rules/*.mdc`、`.cursorignore`、`.gitignore`、`.dockerignore` 全部下沉到项目根,内部 `exam-splitter/...` 前缀全部去除;文档(`README.md`、`docs/development.md`、`docs/testing.md`、`docs/architecture.md`)同步更新。
  - 后续直接以本目录为项目根打开。

- 工程化重构(二):
  - `backend/pytest.ini` 增加 `-p no:cacheprovider`,避免本地产生 `.pytest_cache/` 污染。

- 工程化重构(一):
  - 把旧版 Flask 单体(`split_exam.py / webapp.py / templates / Dockerfile / docker-compose.yml / requirements.txt / preview / assets`)整体替换为 FastAPI + React 工程化版本。
  - 引入 `docs/`(架构 / 开发 / API / 测试 / 变更日志 / 贡献指南),`README.md` 仅留终端用户视角。
  - 后端补齐 docstring 与 FastAPI 路由 `summary/description`;`@app.on_event("startup")` 升级到 `lifespan`。
  - 后端引入 `pytest`,新增 22 个用例(schemas / storage / pdf_service / ppt_service / API 集成)。
  - 修复 `pdf_service.build_pdf` 在「所有段无效」时调用 PyMuPDF `save` 抛 `ValueError: cannot save with zero pages` 的问题,改为返回 0,让上层路由返回 422。
  - `ppt_service.build_pptx` 同步语义修正(`made == 0` 时不写文件)。
  - 前端引入 `vitest + jsdom + @testing-library/react`,新增 10 个用例(`api.ts` 5 个 / `QuestionList` 3 个 / `ExportPanel` 2 个)。
  - 新增 `.cursorignore` 与 `.cursor/rules/{project-core,backend,frontend}.mdc` 工程规则文件,强化「接口注释 / 文档同步 / 跑通测试」三项强制约定。

## 2026-06-02(更早)

- 首次落地工程化版本:
  - 后端 FastAPI + PyMuPDF + python-pptx,前端 Vite + React + TS + react-konva。
  - 三个核心接口:`POST /api/upload`、`GET /api/pages/{doc_id}/{name}`、`POST /api/export/{doc_id}`。
  - Docker Compose:`backend`(uvicorn)+ `frontend`(Nginx + `/api` 反代),宿主 8080 暴露。
