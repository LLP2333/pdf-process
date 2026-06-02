# 贡献指南

## 核心约定(强制)

1. **接口必须有注释**:每个 FastAPI 路由都要有 `summary` + `description`,函数有中文 docstring;
   每个后端服务函数 / 前端 `api.ts` 导出函数都要有 docstring;
   复杂业务逻辑要写 Why,而不是 What。
2. **每次更改都要更新文档**:
   - 修改/新增路由 → 同步更新 [`api.md`](./api.md);
   - 修改数据流 / 目录结构 / 设计决策 → 同步更新 [`architecture.md`](./architecture.md);
   - 新增运行环境 / 命令 / 环境变量 → 同步更新 [`development.md`](./development.md);
   - 新增 / 调整测试用例 → 同步更新 [`testing.md`](./testing.md);
   - 不管是哪种,在 [`CHANGELOG.md`](./CHANGELOG.md) 顶部追加一行(日期 + 简述)。
3. **测试必须跑通**:
   - 后端:`cd backend && .venv/bin/pytest`
   - 前端:`cd frontend && npm test && npm run build`
   - 不允许通过 `skip / xfail` 绕过失败,除非有 issue 链接且在 PR 描述里说明原因。
4. **新增逻辑配套新增测试**:接口、服务函数、组件交互都要有至少一个测试覆盖正例+一个反例。

## 代码风格

- **Python**:
  - 4 空格缩进,行宽 120,使用 `from __future__ import annotations`。
  - 用 `pathlib.Path` 处理路径,不要拼字符串。
  - 用 `pydantic.BaseModel` 描述外部契约,不要用裸 dict。
  - 异常抛 `HTTPException` 并提供中文 `detail`。
- **TypeScript / React**:
  - 严格模式(`tsconfig` 已 `strict: true`),禁止 `any`,无法避免时显式 `unknown` + 断言。
  - 组件:函数组件 + hooks;无副作用渲染。
  - 命名:文件 `PascalCase.tsx` / `camelCase.ts`;函数 `camelCase`。
- **测试**:
  - 描述使用中文,清晰说明「在什么场景下,期望发生什么」。
  - 共用夹具放 `conftest.py` 或 `tests/setup.ts`。

## 提交流程

1. 创建分支,命名 `feat/...`、`fix/...`、`docs/...`、`test/...`、`refactor/...`。
2. 实现 + 同步文档 + 同步/新增测试。
3. 本地跑通(见上)。
4. 提交信息推荐采用 [Conventional Commits](https://www.conventionalcommits.org/) 风格,例如:
   - `feat(backend): 加 /api/auto_detect 自动识别题号`
   - `fix(pdf_service): 空段时不再写空 PDF`
   - `docs(api): 补充 422 的触发条件`
5. 在 PR 描述里复制 `CHANGELOG.md` 的本次条目。

## 不要做的事

- 直接编辑 `uploads/` 或 `outputs/` 下生成的产物。
- 在 `app.main` 里写业务逻辑(请抽到 `pdf_service` / `ppt_service`)。
- 在前端绕过 `api.ts` 直接 fetch(便于统一错误处理和未来切换 baseURL)。
- 在后端依赖前端给的像素坐标(永远用 pt)。
