#!/usr/bin/env bash
# 本地开发启停脚本:后端 FastAPI(:8000)+ 前端 Vite(:5173)
#
# 用法:./dev.sh {start|stop|restart|status|logs [backend|frontend]}

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="$ROOT/.run"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

mkdir -p "$RUN_DIR"

port_pids() { lsof -ti tcp:"$1" -sTCP:LISTEN 2>/dev/null || true; }

is_running() {
  local pidfile="$RUN_DIR/$1.pid"
  [[ -f "$pidfile" ]] && kill -0 "$(cat "$pidfile")" 2>/dev/null
}

wait_http() {
  local url=$1 name=$2
  for _ in $(seq 1 30); do
    curl -sf -o /dev/null "$url" && { echo "  ✓ $name 已就绪:$url"; return 0; }
    sleep 1
  done
  echo "  ✗ $name 30 秒内未就绪,查看日志:./dev.sh logs $name" >&2
  return 1
}

start_backend() {
  if is_running backend || [[ -n "$(port_pids "$BACKEND_PORT")" ]]; then
    echo "• backend 已在运行(端口 $BACKEND_PORT)"; return
  fi
  if [[ ! -x "$ROOT/backend/.venv/bin/uvicorn" ]]; then
    echo "• 初始化后端虚拟环境..."
    python3 -m venv "$ROOT/backend/.venv"
    "$ROOT/backend/.venv/bin/pip" install -q -r "$ROOT/backend/requirements.txt"
  fi
  echo "• 启动 backend..."
  (
    cd "$ROOT/backend"
    EXAM_SPLITTER_DATA_DIR="$ROOT" nohup .venv/bin/uvicorn app.main:app \
      --reload --port "$BACKEND_PORT" >"$RUN_DIR/backend.log" 2>&1 &
    echo $! >"$RUN_DIR/backend.pid"
  )
  wait_http "http://localhost:$BACKEND_PORT/api/health" backend
}

start_frontend() {
  if is_running frontend || [[ -n "$(port_pids "$FRONTEND_PORT")" ]]; then
    echo "• frontend 已在运行(端口 $FRONTEND_PORT)"; return
  fi
  if [[ ! -d "$ROOT/frontend/node_modules" ]]; then
    echo "• 安装前端依赖..."
    (cd "$ROOT/frontend" && npm install --silent)
  fi
  echo "• 启动 frontend..."
  (
    cd "$ROOT/frontend"
    nohup npm run dev -- --port "$FRONTEND_PORT" --strictPort \
      >"$RUN_DIR/frontend.log" 2>&1 &
    echo $! >"$RUN_DIR/frontend.pid"
  )
  wait_http "http://localhost:$FRONTEND_PORT" frontend
}

stop_one() {
  local name=$1 port=$2 pidfile="$RUN_DIR/$1.pid" pids=""
  # 杀掉 pid 文件记录的进程及其子进程(uvicorn --reload / npm 都会派生子进程)
  if [[ -f "$pidfile" ]]; then
    local pid; pid=$(cat "$pidfile")
    pids="$pid $(pgrep -P "$pid" 2>/dev/null || true)"
  fi
  # 兜底:按端口找(覆盖非本脚本启动的实例)
  pids="$pids $(port_pids "$port")"
  pids=$(echo "$pids" | xargs -n1 2>/dev/null | sort -u | xargs 2>/dev/null || true)
  if [[ -z "$pids" ]]; then
    echo "• $name 未运行"
  else
    kill $pids 2>/dev/null || true
    for _ in $(seq 1 10); do
      [[ -z "$(port_pids "$port")" ]] && break
      sleep 0.5
    done
    [[ -n "$(port_pids "$port")" ]] && kill -9 $(port_pids "$port") 2>/dev/null || true
    echo "• $name 已停止"
  fi
  rm -f "$pidfile"
}

status() {
  for pair in "backend:$BACKEND_PORT" "frontend:$FRONTEND_PORT"; do
    local name=${pair%%:*} port=${pair##*:}
    if [[ -n "$(port_pids "$port")" ]]; then
      echo "• $name 运行中  http://localhost:$port"
    else
      echo "• $name 未运行"
    fi
  done
}

case "${1:-}" in
  start)
    start_backend
    start_frontend
    echo
    echo "打开 http://localhost:$FRONTEND_PORT 使用;日志:./dev.sh logs"
    ;;
  stop)
    stop_one frontend "$FRONTEND_PORT"
    stop_one backend "$BACKEND_PORT"
    ;;
  restart)
    "$0" stop
    "$0" start
    ;;
  status)
    status
    ;;
  logs)
    case "${2:-}" in
      backend|frontend) tail -f "$RUN_DIR/$2.log" ;;
      "") tail -f "$RUN_DIR/backend.log" "$RUN_DIR/frontend.log" ;;
      *) echo "未知服务:$2(可选 backend / frontend)" >&2; exit 1 ;;
    esac
    ;;
  *)
    echo "用法:$0 {start|stop|restart|status|logs [backend|frontend]}"
    exit 1
    ;;
esac
