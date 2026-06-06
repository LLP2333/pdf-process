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
| `EXAM_SPLITTER_MAX_UPLOAD_MB` | `64` | 单文件上传上限(MB),超出返回 413 |
| `EXAM_SPLITTER_MAX_STORAGE_MB` | `2048`(2GB) | `uploads + outputs` 总占用软上限;超出按 LRU 清理保护期外的旧 doc,清不下来时本次上传 507 |
| `EXAM_SPLITTER_PROTECT_SECONDS` | `300`(5min) | LRU 清理保护期:最近 N 秒动过的 doc 不会被强制清理 |

前端容器(`nginx`)同步可配:

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `CLIENT_MAX_BODY_SIZE` | `80m` | nginx 反代单请求体上限。**必须 ≥ 后端 `EXAM_SPLITTER_MAX_UPLOAD_MB`**,否则大文件会被反代提前砍掉,后端拿不到机会返回 413 |

## 前端

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173,/api 自动代理到 :8000
```

如需指向其它后端:`BACKEND_URL=http://1.2.3.4:8000 npm run dev`。

## 一键(Docker Compose)

服务默认接入外部网络 `qvqw`(`networks.qvqw.external: true`),**两个 service 都不再向宿主暴露端口**,只通过容器名互访 + 由外层反代统一对外。第一次启动前先建好这个网络:

```bash
docker network create qvqw           # 已存在则忽略此步
docker compose up -d --build
```

容器内 `/data/uploads`、`/data/outputs` 通过 compose 挂载到宿主 `uploads/`、`outputs/`,便于排错与持久化。

`compose.yaml` 里的环境变量都走 `${VAR:-默认值}` 形式,可以建一个 `.env` 文件覆盖,例如:

```env
EXAM_SPLITTER_MAX_UPLOAD_MB=128
EXAM_SPLITTER_MAX_STORAGE_MB=5120
CLIENT_MAX_BODY_SIZE=160m
```

> 调大 `MAX_UPLOAD_MB` 时记得同步把 `CLIENT_MAX_BODY_SIZE` 抬上去,且建议留 1.5× 余量(请求体含 multipart 头);**外层反代的 `client_max_body_size` 也要联动**(见下)。

### 外层反代(nginx-proxy / Caddy / traefik)

前端容器内置 nginx 已经把 `/api/*` 反代到 `backend:8000`,所以**外层反代只需要打通到 `http://exam-splitter-frontend:80` 一条路由**就够了,后端不必单独暴露。前置条件:

1. 外层反代容器本身也要加入 `qvqw` 网络,否则 docker 内置 DNS 不认 `exam-splitter-frontend` 这个名字。
2. 外层反代的 `client_max_body_size` ≥ 后端 `MAX_UPLOAD_MB`(建议 1.25× 余量),否则大文件会被外层先砍掉。
3. PDF 解析/导出可能秒级以上,把 `proxy_read_timeout` / `proxy_send_timeout` 抬到 300s 起步。

最小可用的外层 nginx 配置示例:

```nginx
server {
    listen 443 ssl http2;
    server_name exam.example.com;
    # ssl_certificate / ssl_certificate_key ...

    client_max_body_size 96m;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;

    location / {
        proxy_pass http://exam-splitter-frontend:80;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

如果你确实需要"直接用宿主端口测试"(不经过外层反代),临时在 `frontend` 下加一行:

```yaml
    ports:
      - "8080:80"
```

不要把这行作为生产形态保留——它会同时把服务暴露给宿主所有网卡。

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
