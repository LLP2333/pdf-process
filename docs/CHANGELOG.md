# 变更日志

> 倒序排列,每次代码改动都要在顶部追加一行(日期 + 简述)。  
> 体量较大的改动建议附 commit / PR 链接。

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
