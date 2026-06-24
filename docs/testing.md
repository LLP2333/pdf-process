# 测试

## 原则

- **每次代码变更都必须跑通本目录列出的所有测试,且不允许通过 `xfail/skip` 绕过失败**。
- 新增逻辑(尤其是接口与服务函数)必须配套至少一个测试。
- 修复 bug 时,优先写一个能复现该 bug 的失败测试,再让它通过。

## 后端 — pytest

位置:`backend/tests/`,运行入口:`pytest`。

### 公共夹具(`tests/conftest.py`)

- `sample_pdf`:伪造一份两页文字 PDF。
- `scan_pdf`:伪造一份两页"扫描件"(每页只画大灰矩形,无可提取文字层),用于验证 `detect_text_layer` 反例。
- `tmp_storage`:把 `app.storage` 的 `BASE_DIR / UPLOAD_DIR / OUTPUT_DIR` 重定向到临时目录,**避免污染仓库自带的 `uploads/`、`outputs/`**。
- `client`:`fastapi.testclient.TestClient`,依赖 `tmp_storage`。

### 现有覆盖

| 文件 | 覆盖点 |
| --- | --- |
| `test_schemas.py` | Pydantic 字段校验:format 枚举、空 list、margin 范围、page 非负、`auto_trim` 默认值 |
| `test_storage.py` | 路径拼接、`new_doc_id` 格式、`maintenance` 仅清理过期目录 |
| `test_pdf_service.py` | 预览渲染数量与命名、PDF 导出页数、空段过滤、`y1>y2` 自动 swap、段渲染返回 PNG;**`auto_trim` 收紧内容包围盒、全白区域保留原范围、单题预览拼接 / 空题返回 None**;**`detect_text_layer` 文字版 / 扫描件正反例;`auto_detect_dividers` N+1 条线 / 噪音过滤 / 扫描件返回空 / 链长不足返回空** |
| `test_ppt_service.py` | 16:9 尺寸、幻灯片数、空题目跳过 |
| `test_api.py` | 健康检查;上传错误类型/空文件/损坏 PDF;完整流程 upload→pages→export PDF/PPTX;路径遍历防御;不存在 doc 返回 404;全无效段返回 422;**`POST /api/preview/{doc_id}` 正常返回 PNG / 空题 `X-Empty` / 404**;**`POST /api/auto_detect/{doc_id}` 文字版返回 dividers / 扫描件提示 / 不存在 doc 404** |

### 运行

```bash
cd backend
.venv/bin/pytest                  # 全跑
.venv/bin/pytest tests/test_api.py -x    # 单文件,首个失败即停
.venv/bin/pytest -k "export"             # 按名字过滤
```

### 期望状态

当前:**50 passed**。

## 前端 — vitest + Testing Library

位置:`frontend/tests/`,运行入口:`npm test`(`vitest run`)或 `npm run test:watch`。

### 现有覆盖

| 文件 | 覆盖点 |
| --- | --- |
| `api.test.ts` | uploadPdf 成功/失败;exportFile 解析中文 Content-Disposition、回退默认名、错误抽取;`previewQuestion` 解析 `X-Empty` / 错误抽取;**`autoDetect` 文字版 / 扫描件 / 失败时抛出 detail** |
| `dividers.test.ts` | `buildQuestionsFromDividers`:0/1 条分割线返回空、N 条 → N-1 道题、跨页拆段、乱序排序、稳定 id;`applyAdjustmentToQuestion`:无调整 / 顶裁 / 底裁 / 过度裁剪丢弃越界段 |
| `QuestionList.test.tsx` | 0/1 条分割线的两种引导文案、单页 vs「跨 N 页」标签、二次裁剪 ✎ 角标、清空按钮禁用、点击触发选中 |
| `ExportPanel.test.tsx` | 无题时按钮禁用 + 文案;有题时按钮带题数 + 触发预览;auto_trim / margin 受控联动并被夹到 0-120;**「自动识别题号」按钮触发回调 / 加载态文案 / 三色提示样式** |
| `PreviewModal.test.tsx` | open=false 不渲染;打开后渲染每题图片;改顶部滑块带 question id 触发回调;关闭回调;导出时 segments 已应用 adjustment;**每题"是否导出"复选框:回调 / 灰显 className / 头部 X/Y 计数 / 全排除时按钮禁用 (0) / 导出请求体过滤 + 剩余题号重排** |

> `PdfPage` 重度依赖 `react-konva` + Canvas,jsdom 难以稳定测;暂以视觉手测为主,后续可考虑 Playwright e2e。

### 运行

```bash
cd frontend
npm test                # 一次性
npm run test:watch      # 监听
npm run build           # 顺带 tsc -b 严格类型检查
```

### 期望状态

当前:**47 passed**;`npm run build` 通过。

## CI 建议

最小流水线:

```yaml
backend:
  - python -m pip install -r backend/requirements.txt
  - pytest backend
frontend:
  - cd frontend && npm ci && npm run build && npm test
```
