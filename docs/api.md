# API 参考

所有路由都在 `/api` 命名空间下,以 JSON 交换数据(上传与下载除外)。  
完整的 OpenAPI 文档由 FastAPI 在 `http://localhost:8000/docs` 自动渲染。

## 资源模型

### `PageInfo`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `index` | int | 页码,从 0 开始 |
| `width` | float | 页宽(pt,与 PDF 原始坐标一致) |
| `height` | float | 页高(pt) |
| `image_url` | string | 预览 PNG 的相对 URL |
| `image_width` | int | PNG 像素宽 |
| `image_height` | int | PNG 像素高 |

### `Region`

一道题在**某份文档**某一页上的矩形裁剪区域(pt,PDF 原始坐标)。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `doc_id` | string | 所属文档 ID(16 位小写 hex);**逐个过与路由相同的白名单校验** |
| `page` | int (≥0) | 页码 |
| `x1` / `y1` | float (≥0) | 矩形一角 |
| `x2` / `y2` | float (≥0) | 矩形对角;后端自动 `min/max`,任意对角线画框顺序都合法 |

**关键约定**:

1. 区域自带 `doc_id` ⇒ 一道题可以跨页、跨栏、**跨多份已上传的文档**组合;
2. 坐标超出页面会被 clamp 到页界;规范化后宽或高 < 1pt 的区域直接丢弃;
3. 导出/预览时区域按列表顺序**纵向堆叠**,每个区域各自水平居中。

### `Question`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `no` | int (≥1) | 题号,导出按此排序 |
| `regions` | `Region[]`,≥1 | 按序纵向堆叠 |

### `ExportRequest`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `format` | `"pdf"` \| `"pptx"` | 导出格式 |
| `bottom_space` | float (0–80,默认 5) | 题目下方至少预留的留白,占页高百分比;左 / 右 / 上固定 28pt。PDF 与 PPTX 共用 |
| `auto_trim` | bool,默认 `true` | 是否自动去除每个区域**四周**(x/y 双向)的白边(像素扫描内容包围盒) |
| `footer_text` | string?,≤50 字符 | 可选页脚署名:每页 / 每张幻灯片左下角灰字;留空不加 |
| `footer_size` | float (6–24),默认 `8` | 署名字号(pt);仅在 `footer_text` 非空时生效 |
| `source_name` | string? | 上传时的原始文件名,用于拼下载名 |
| `questions` | `Question[]`,≥1 | 切分方案 |

### `PreviewRequest`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `question` | `Question` | 单题切分;多区域会被纵向拼接成一张 PNG |
| `auto_trim` | bool,默认 `true` | 同 `ExportRequest.auto_trim` |

### `DividerSuggestion`

自动识别返回的"草稿分割线",仅含位置信息;前端把相邻两条转换成整页宽草稿题框。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `page` | int (≥0) | 所在页 |
| `y` | float (≥0) | 纵坐标(pt) |

### `AutoDetectResponse`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `is_text` | bool | 是否文字版 PDF(每页可提取字符数 ≥ 20) |
| `page_count` | int (≥0) | 页数 |
| `char_count` | int (≥0) | 全文档可提取非空白字符总数 |
| `dividers` | `DividerSuggestion[]` | 候选分割线;扫描件 / 无题号匹配时为空 |
| `message` | string | 面向用户的中文提示 |

## 路由

### `GET /api/health`

健康检查。

```bash
curl http://localhost:8000/api/health
# {"status":"ok"}
```

### `POST /api/upload`

`multipart/form-data`,字段名 `file`,内容为 PDF。**多文档组卷 = 多次调用本接口**,每份文件各得一个独立 `doc_id`。

**成功 200**:

```json
{
  "doc_id": "c5743fe2a02c4537",
  "filename": "sample.pdf",
  "page_count": 2,
  "pages": [
    { "index": 0, "width": 595, "height": 842,
      "image_url": "/api/pages/c5743fe2a02c4537/page_000.png",
      "image_width": 1587, "image_height": 2245 }
  ]
}
```

**失败**:
- `400` 非 PDF / 空文件
- `413` 超过单文件上限
- `422` PyMuPDF 无法解析(损坏或加密)
- `507` 存储空间不足

### `GET /api/pages/{doc_id}/{name}`

返回上一接口产生的预览 PNG(192 DPI)。`name` 必须匹配 `page_<3 位数字>.png`,否则 404。

### `POST /api/preview`

单题实时预览。**路由不再绑定单一文档** —— 区域自带 `doc_id`。后端按 `auto_trim` 处理后,把该题所有区域(可跨页/跨文档)纵向拼接成一张 PNG。

**请求体** (`PreviewRequest`):

```json
{
  "question": {
    "no": 1,
    "regions": [
      { "doc_id": "c5743fe2a02c4537", "page": 0, "x1": 40, "y1": 200, "x2": 560, "y2": 842 },
      { "doc_id": "9f21ab34cd56ef78", "page": 1, "x1": 0, "y1": 0, "x2": 595, "y2": 300 }
    ]
  },
  "auto_trim": true
}
```

**成功 200**:

- `Content-Type`:`image/png`
- 无任何有效区域时,返回一张 1x1 占位 PNG,并附 `X-Empty: 1`

**失败**:
- `404` 任一 `doc_id` 非法 / 不存在 / 已过期(统一文案,不区分原因)
- `500` 服务器内部异常

### `POST /api/export`

按切分方案导出 PDF 或 PPTX。同样是文档无关路由,`questions` 里引用到的所有 `doc_id` 会被逐个校验。

**请求体**:

```json
{
  "format": "pdf",
  "bottom_space": 5,
  "auto_trim": true,
  "footer_text": "整理:张老师",
  "footer_size": 10,
  "source_name": "2024期末数学.pdf",
  "questions": [
    { "no": 1,
      "regions": [{ "doc_id": "c5743fe2a02c4537", "page": 0, "x1": 0, "y1": 120, "x2": 595, "y2": 300 }] },
    { "no": 2,
      "regions": [
        { "doc_id": "c5743fe2a02c4537", "page": 0, "x1": 0, "y1": 300, "x2": 297, "y2": 500 },
        { "doc_id": "9f21ab34cd56ef78", "page": 1, "x1": 0, "y1": 120, "x2": 595, "y2": 240 }
      ] }
  ]
}
```

- `footer_text`(可选):每页左下角灰字署名(内置 CJK 字体,中文不乱码);留空 / 不传则不加。`footer_size` 控制字号(6–24pt,默认 8);PDF 基线固定在离页底 12pt 处、PPTX 文本框底部锚定,字号变大时向上生长。
- `source_name`(可选):后端取其主干拼出下载名 `<原名>_切割重组.<ext>`;未传或清洗后为空时回退到固定名 `试卷切割重组.<ext>`。多文档时前端约定传第一份文档的文件名。

**成功 200**:

- `Content-Type`:`application/pdf` 或 `application/vnd.openxmlformats-officedocument.presentationml.presentation`
- `Content-Disposition`:`attachment; filename*=UTF-8''<原名>_切割重组.<ext>`
- `X-Question-Count`:实际生成的题目数(字符串)

**失败**:
- `404` 任一 `doc_id` 非法 / 不存在 / 已过期
- `422` 全部区域规范化后无效(`page` 越界 / 宽高 < 1pt),或 `footer_text` 超长等模型校验失败
- `500` 服务器内部异常(`detail` 会带原因)

### `POST /api/auto_detect/{doc_id}`

判断 PDF 是否文字版,并按"行首题号"自动给出草稿分割线。无请求体。
前端把相邻两条分割线转换为**整页宽草稿题框**(定位为辅助功能:识别结果必然需要手动微调,框选才是主交互)。

**结果模型(三种业务场景统一 200,通过字段区分)**:

1. 扫描件(文字层稀疏,每页可提取字符 < 20):

```json
{
  "is_text": false,
  "page_count": 4,
  "char_count": 5,
  "dividers": [],
  "message": "该 PDF 似乎是扫描件(无文字层),无法自动识别题号,请手动添加分割线。"
}
```

2. 文字版但找不到稳定的题号链(链长 < 2,例如全文只有一个 "1."):

```json
{
  "is_text": true,
  "page_count": 2,
  "char_count": 432,
  "dividers": [],
  "message": "文档是文字版,但未能识别到稳定的题号序列,请手动添加分割线。"
}
```

3. 文字版且识别到 N 题(N ≥ 2):返回 **N+1** 条分割线(N 条题首 + 1 条末题底界)。

**识别策略**(详见 `pdf_service.auto_detect_dividers`):
- 行首正则 `^\s*(\d{1,3})\s*[\.\、\)\)]\s*\S`,要求题号后紧跟非空白字符;
- 题号必须落在页面左侧(`bbox.x0 < 页宽 * 0.5`),过滤右栏页码 / 答题卡占位;
- 候选按 (page, y) 排序后,用 O(n²) DP 选出"差为 1 的最长升序链",排除"选项里的 1."、"第 1 页"等噪音;
- 末题下界放在链中最后一个题号所在页底部 `height - 6pt`,避免把"参考答案"卷入最后一题。

**失败**:
- `404` `doc_id` 不存在或已过期
- `500` PyMuPDF 读取异常(`detail` 给出原因)

### 错误响应统一格式

```json
{ "detail": "中文错误描述" }
```

前端 `api.ts` 会自动抽取 `detail`,所以接口异常文案直接到用户眼前,请保持简短可读。
