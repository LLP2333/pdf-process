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

### `Segment`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `page` | int (≥0) | 页码 |
| `y1` | float (≥0) | 起始 y(pt) |
| `y2` | float (≥0) | 结束 y(pt);后端会自动处理 `y1 > y2` 的情形 |

### `QuestionTrim`

题目级别的"二次裁剪"(用户在预览弹窗里手动加的微调)。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `top` | float (≥0) | 题目第一段上方再裁掉的 pt 数 |
| `bottom` | float (≥0) | 题目最后一段下方再裁掉的 pt 数 |

**关键约定**:

1. `trim` 在 `auto_trim` **之后**生效。后端不会把 `top/bottom` 混到 segment 的 clip 里再做像素扫描,而是先用 `auto_trim` 收紧 clip,**再**额外吃掉 trim 量。这样可避免"用户调的量 < 自动收紧量"时被吞掉,让微调始终可见(特别是跨页题的顶部)。
2. `trim` **跨段级联**:若 `top` 大到把第一段吃光,剩余量继续吃第二段的顶部;`bottom` 同理向前累积。这是跨页题的核心场景 —— 比如用 `bottom` 把第二页那段整个吃掉、再继续吃掉第一页底部的"第 N 页(共 N 页)"页脚。
3. 若所有段都被吃光,返回空段集,接口侧表现为预览的 `X-Empty: 1` 或导出的 `422`。

### `Question`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `no` | int (≥1) | 题号 |
| `segments` | `Segment[]`,≥1 | 按段顺序拼接;一道题跨页时多段 |
| `trim` | `QuestionTrim?` | 可选;未传或全 0 时等价于不裁 |

### `ExportRequest`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `format` | `"pdf"` \| `"pptx"` | 导出格式 |
| `margin` | float (0–120) | 页面四周留白(pt),PDF 与 PPTX 共用 |
| `auto_trim` | bool,默认 `true` | 是否在裁剪前自动去除每段上下白边(像素扫描) |
| `questions` | `Question[]`,≥1 | 切分方案 |

### `PreviewRequest`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `question` | `Question` | 单题切分;跨页会被纵向拼接成一张 PNG |
| `auto_trim` | bool,默认 `true` | 同 `ExportRequest.auto_trim` |

### `DividerSuggestion`

自动识别返回的"草稿分割线",仅含位置信息,不含前端的稳定 id;前端拿到列表后自行赋 id。

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
| `message` | string | 面向用户的中文提示(扫描件 / 文字版但未识别到题号 / 已识别 N 题) |

## 路由

### `GET /api/health`

健康检查。

```bash
curl http://localhost:8000/api/health
# {"status":"ok"}
```

### `POST /api/upload`

`multipart/form-data`,字段名 `file`,内容为 PDF。

**成功 200**:

```json
{
  "doc_id": "c5743fe2a02c4537",
  "filename": "sample.pdf",
  "page_count": 2,
  "pages": [
    { "index": 0, "width": 595, "height": 842,
      "image_url": "/api/pages/c5743fe2a02c4537/page_000.png",
      "image_width": 1190, "image_height": 1684 }
  ]
}
```

**失败**:
- `400` 非 PDF / 空文件
- `422` PyMuPDF 无法解析(损坏或加密)

### `GET /api/pages/{doc_id}/{name}`

返回上一接口产生的预览 PNG。`name` 必须匹配 `page_<3 位数字>.png`,否则 404。

### `POST /api/preview/{doc_id}`

单题实时预览。后端会按 `auto_trim` 处理后,把该题(可能跨页)纵向拼接成一张 PNG。

**请求体** (`PreviewRequest`):

```json
{
  "question": {
    "no": 1,
    "segments": [
      { "page": 0, "y1": 200, "y2": 842 },
      { "page": 1, "y1": 0, "y2": 300 }
    ],
    "trim": { "top": 12, "bottom": 18 }
  },
  "auto_trim": true
}
```

**成功 200**:

- `Content-Type`:`image/png`
- 无任何有效段时,返回一张 1x1 占位 PNG,并附 `X-Empty: 1`

**失败**:
- `404` `doc_id` 不存在或已过期
- `500` 服务器内部异常

### `POST /api/export/{doc_id}`

按切分方案导出 PDF 或 PPTX。

**请求体**:

```json
{
  "format": "pdf",
  "margin": 28,
  "auto_trim": true,
  "source_name": "2024期末数学.pdf",
  "questions": [
    { "no": 1, "segments": [{ "page": 0, "y1": 120, "y2": 300 }] },
    { "no": 2,
      "segments": [
        { "page": 0, "y1": 300, "y2": 500 },
        { "page": 1, "y1": 120, "y2": 240 }
      ],
      "trim": { "top": 0, "bottom": 24 }
    }
  ]
}
```

- `source_name`(可选):上传时的原始文件名,可带 `.pdf` 扩展名。后端会取其主干拼出下载名 `<原名>_切割重组.<ext>`;未传或清洗后为空时回退到固定名 `试卷切割重组.<ext>`。

**成功 200**:

- `Content-Type`:`application/pdf` 或 `application/vnd.openxmlformats-officedocument.presentationml.presentation`
- `Content-Disposition`:`attachment; filename*=UTF-8''<原名>_切割重组.<ext>`(未传 `source_name` 时为 `试卷切割重组.<ext>`)
- `X-Question-Count`:实际生成的题目数(字符串)

**失败**:
- `404` `doc_id` 不存在或已过期
- `422` 全部段都被规范化后判为无效(`page` 越界 / `y1 == y2`)
- `500` 服务器内部异常(`detail` 会带原因)

### `POST /api/auto_detect/{doc_id}`

判断 PDF 是否文字版,并按"行首题号"自动给出草稿分割线。无请求体。

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

```json
{
  "is_text": true,
  "page_count": 2,
  "char_count": 1280,
  "dividers": [
    { "page": 0, "y": 94 },
    { "page": 0, "y": 254 },
    { "page": 1, "y": 110 },
    { "page": 1, "y": 836 }
  ],
  "message": "已自动识别到 3 道题,可在 PDF 上微调或删除分割线。"
}
```

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
