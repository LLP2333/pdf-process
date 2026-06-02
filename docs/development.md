# 本地开发

## 准备

- Python 3.12+(项目用 3.14 验证过,3.12 也可,Docker 镜像走 3.12-slim)
- Node.js 20+(项目验证过 v26.2.0)
- 可选:Docker Desktop(完整端到端最快)

## 后端

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
EXAM_SPLITTER_DATA_DIR=$(cd .. && pwd) \
  uvicorn app.main:app --reload --port 8000
```

启动后访问:

- `http://localhost:8000/api/health` — 健康检查
- `http://localhost:8000/docs`        — Swagger UI(基于 FastAPI 自动生成)
- `http://localhost:8000/redoc`       — ReDoc

环境变量:

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `EXAM_SPLITTER_DATA_DIR` | backend 上一级 | `uploads/`、`outputs/` 根目录 |
| `EXAM_SPLITTER_RETENTION` | `86400`(24h) | doc 过期秒数,超时由 `storage.maintenance()` 清理 |

## 前端

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173,/api 自动代理到 :8000
```

如需指向其它后端:`BACKEND_URL=http://1.2.3.4:8000 npm run dev`。

## 一键(Docker Compose)

```bash
docker compose up -d --build
# 浏览器: http://localhost:8080
```

容器内 `/data/uploads`、`/data/outputs` 通过 compose 挂载到宿主 `uploads/`、`outputs/`,便于排错与持久化。

## 常用命令速查

| 目标 | 命令 |
| --- | --- |
| 后端测试 | `cd backend && .venv/bin/pytest` |
| 后端 lint(若引入 ruff) | `ruff check app tests` |
| 前端构建 | `cd frontend && npm run build` |
| 前端测试 | `cd frontend && npm test` |
| 前端测试监听 | `cd frontend && npm run test:watch` |
| Docker 重新构建 | `docker compose up -d --build` |
| 实时日志 | `docker compose logs -f backend` |
| 停服并清理容器 | `docker compose down` |

## 调试技巧

- **PDF 解析失败**:在 `backend` 启动 `--reload` 模式,直接 `uvicorn ... --log-level debug`,FastAPI 会把异常堆栈打到 stderr。
- **预览图找不到**:确认 `outputs/<doc_id>/page_NNN.png` 存在;若挂载有问题,容器内 `ls /data/outputs/<doc_id>/`。
- **导出 422**:多半是切分方案里所有段都越界或空高,前端在 `ExportPanel` 已经做了「全空校验」。
