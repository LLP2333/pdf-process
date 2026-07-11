# 测试

## 原则

- **每次代码变更都必须跑通本目录列出的所有测试,且不允许通过 `xfail/skip` 绕过失败**。
- 新增逻辑(尤其是接口与服务函数)必须配套至少一个测试。
- 修复 bug 时,优先写一个能复现该 bug 的失败测试,再让它通过。

## 后端 — pytest

位置:`backend/tests/`,运行入口:`pytest`。

### 公共夹具(`tests/conftest.py`)

- `sample_pdf`:伪造一份两页文字 PDF(内容横向 72..520pt、纵向 80pt 起,x/y 双向去白边测试依赖这个几何)。
- `second_pdf`:另一份单页 PDF,带 `SECOND-DOC` 独特文字标记,用于**多文档组题**测试。
- `scan_pdf`:伪造一份两页"扫描件"(每页只画大灰矩形,无可提取文字层),用于验证 `detect_text_layer` 反例。
- `tmp_storage`:把 `app.storage` 的 `BASE_DIR / UPLOAD_DIR / OUTPUT_DIR` 重定向到临时目录,**避免污染仓库自带的 `uploads/`、`outputs/`**。
- `client`:`fastapi.testclient.TestClient`,依赖 `tmp_storage`。

### 现有覆盖

| 文件 | 覆盖点 |
| --- | --- |
| `test_schemas.py` | Pydantic 字段校验:format 枚举、空 questions/regions、margin 范围、page/坐标非负、对角线画框合法、`auto_trim` 默认值、**`footer_text` ≤50 字符正反例、`footer_size` 默认 8 / 越界(5、25)拒绝** |
| `test_storage.py` | 路径拼接、`new_doc_id` 格式、`maintenance` 仅清理过期目录 |
| `test_pdf_service.py` | 预览渲染数量与命名;**regions 契约**:PDF 导出页数、空区域/越界/未知 doc 过滤、对角线 swap、页界 clamp、**跨两份文档组题(输出含两份文档文字)**;**auto_trim x/y 双向收紧**、全白区域保留原范围;**横向裁剪真实生效(x 范围外文字不出现在导出)**;**footer_text 每页出现/未传不出现、footer_size 落到文字层 span 字号**;单题预览拼接(跨文档)/ 空题返回 None;`detect_text_layer` 文字版 / 扫描件正反例;`auto_detect_dividers` N+1 条线 / 噪音过滤 / 扫描件返回空 / 链长不足返回空 |
| `test_ppt_service.py` | 16:9 尺寸、幻灯片数、空题目跳过、**页脚文本框正反例、footer_size 落到 run 字号** |
| `test_api.py` | 健康检查;上传错误类型/空文件/损坏 PDF/超限 413/LRU/保护期 507;完整流程 upload→pages→export PDF/PPTX(含限定 x 范围的区域);**`POST /api/export` 多文档组题**、任一区域 doc 缺失整体 404、全无效区域 422、**footer_text 走通链路落在 PDF 文字层 / 超长 422**、下载名正反例;**`POST /api/preview`(文档无关路由)**正常 PNG / 空题 `X-Empty` / 404;请求体内非法 doc_id(长度/大写/非 hex/遍历)统一 404;`POST /api/auto_detect/{doc_id}` 文字版返回 dividers / 扫描件提示 / 不存在 doc 404 |

### 运行

```bash
cd backend
.venv/bin/pytest                  # 全跑
.venv/bin/pytest tests/test_api.py -x    # 单文件,首个失败即停
.venv/bin/pytest -k "export"             # 按名字过滤
```

### 期望状态

当前:**61 passed**。

## 前端 — vitest + Testing Library

位置:`frontend/tests/`,运行入口:`npm test`(`vitest run`)或 `npm run test:watch`。
`tests/setup.ts` 里补了 jsdom 缺失的 `URL.createObjectURL / revokeObjectURL` 最小桩。

### 现有覆盖

| 文件 | 覆盖点 |
| --- | --- |
| `editorState.test.ts` | `normalizeRect` 对角线归一;**排序插入**(同文档回头补漏 / 跨文档按 rail 顺序);区域追加/几何更新/删除(最后一个区域删除整题)/未知 id no-op;`removeDocRegions` 级联清理;`moveQuestion` 重排与非法下标;excluded 往返;`buildExportQuestions` 过滤 + 连续重编号 + 已删文档区域剔除;`buildPreviewQuestion` 空题返回 null;**撤销栈**:commit/undo/redo 往返、no-op commit、redo 分支清空、`replacePresent`+`commitFrom` 拖动手势单步入栈、栈深上限;`draftQuestionsFromDividers` N+1 条线 → N 题 / 跨页拆区域 / 空段丢弃 |
| `api.test.ts` | uploadPdf 成功/失败;**exportFile 走 `/api/export` 且请求体带 footer_text / footer_size 与 regions**、解析中文 Content-Disposition、回退默认名、错误抽取;**previewQuestion 走 `/api/preview`** 解析 `X-Empty` / 错误抽取;autoDetect 文字版 / 扫描件 / 失败时抛出 detail |
| `QuestionPanel.test.tsx` | 空态引导文案;卡片题号/多文档徽标(卷 A+B)/区域计数 + 防抖后拉取预览(校验请求体);excluded 灰显 + "不导出"徽标 + 计数文案;勾选/删除回调且不冒泡成选中;**区域全部失效(文档已删)显示空态且不发请求** |
| `TopBar.test.tsx` | 导出按钮回调格式;无可导出题禁用;撤销/重做可用性;设置弹层:页脚署名 / 页边距(夹到 0-120)/ 去白边回调;**署名字号:未填署名时禁用、修改回调且夹到 6-24**;未上传时不渲染工具区 |

> `PageCanvas` 重度依赖 `react-konva` + Canvas,jsdom 难以稳定测;暂以视觉手测为主,后续可考虑 Playwright e2e。

### 运行

```bash
cd frontend
npm test                # 一次性
npm run test:watch      # 监听
npm run build           # 顺带 tsc -b 严格类型检查
```

### 期望状态

当前:**40 passed**;`npm run build` 通过。

## CI 建议

最小流水线:

```yaml
backend:
  - python -m pip install -r backend/requirements.txt
  - pytest backend
frontend:
  - cd frontend && npm ci && npm run build && npm test
```
