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

### `Question`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `no` | int (≥1) | 题号 |
| `segments` | `Segment[]`,≥1 | 按段顺序拼接;一道题跨页时多段 |

### `ExportRequest`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `format` | `"pdf"` \| `"pptx"` | 导出格式 |
| `margin` | float (0–120) | 页面四周留白(pt),PDF 与 PPTX 共用 |
| `questions` | `Question[]`,≥1 | 切分方案 |

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

### `POST /api/export/{doc_id}`

按切分方案导出 PDF 或 PPTX。

**请求体**:

```json
{
  "format": "pdf",
  "margin": 28,
  "questions": [
    { "no": 1, "segments": [{ "page": 0, "y1": 120, "y2": 300 }] },
    { "no": 2, "segments": [
      { "page": 0, "y1": 300, "y2": 500 },
      { "page": 1, "y1": 120, "y2": 240 }
    ]}
  ]
}
```

**成功 200**:

- `Content-Type`:`application/pdf` 或 `application/vnd.openxmlformats-officedocument.presentationml.presentation`
- `Content-Disposition`:`attachment; filename*=UTF-8''试卷切割重组.<ext>`
- `X-Question-Count`:实际生成的题目数(字符串)

**失败**:
- `404` `doc_id` 不存在或已过期
- `422` 全部段都被规范化后判为无效(`page` 越界 / `y1 == y2`)
- `500` 服务器内部异常(`detail` 会带原因)

### 错误响应统一格式

```json
{ "detail": "中文错误描述" }
```

前端 `api.ts` 会自动抽取 `detail`,所以接口异常文案直接到用户眼前,请保持简短可读。
