"""Exam Splitter Windows 桌面启动器。

把后端(FastAPI/uvicorn)与已构建的前端静态文件打进同一个进程、同一个端口,
让用户双击 exe 即可在本地浏览器使用,无需 Docker / Node / Python 环境。

设计要点:
- 前端 `api.ts` 调用的是相对路径 `/api/*`,所以只要前后端同源(同一端口)就能直接跑通,
  无需 nginx 反代。这里用 `StaticFiles` 把前端 `dist/` 挂到根路由 `/`,API 路由仍优先匹配。
- 数据目录(uploads/outputs/日志)落到 `%LOCALAPPDATA%\\ExamSplitter`,避免装在
  Program Files 时无写权限;必须在 `import app.main` 之前设置好环境变量,
  因为 `storage.py` 在导入时就读取 `EXAM_SPLITTER_DATA_DIR`。
- uvicorn 跑在后台线程,主线程用 Tkinter 提供「打开网页 / 停止并退出」的启停界面,
  Tkinter 随 Python 标准库分发,无需额外依赖。
"""
from __future__ import annotations

import logging
import os
import socket
import sys
import threading
import time
import webbrowser
from pathlib import Path

APP_NAME = "ExamSplitter"
PREFERRED_PORT = 8000
HOST = "127.0.0.1"


def is_frozen() -> bool:
    """是否运行在 PyInstaller 打包后的 exe 里。"""
    return bool(getattr(sys, "frozen", False))


def project_root() -> Path:
    """源码运行(未打包)时的仓库根目录,用于定位 backend/ 与 frontend/dist。"""
    return Path(__file__).resolve().parents[1]


def resolve_data_dir() -> Path:
    """决定 uploads/outputs/日志 的落盘根目录。

    - 打包后的 exe:写到 `%LOCALAPPDATA%\\ExamSplitter`(无管理员权限也能写),
      `LOCALAPPDATA` 缺失时回退到用户主目录。
    - 源码运行:沿用仓库根,行为与本地开发一致。
    """
    if is_frozen():
        base = os.environ.get("LOCALAPPDATA") or str(Path.home())
        return Path(base) / APP_NAME
    return project_root()


def resolve_static_dir() -> Path:
    """定位前端构建产物目录(index.html 所在处)。

    打包后由 spec 通过 `--add-data` 放到临时解包目录 `sys._MEIPASS/frontend_dist`;
    源码运行时直接用 `frontend/dist`。
    """
    if is_frozen():
        return Path(getattr(sys, "_MEIPASS")) / "frontend_dist"
    return project_root() / "frontend" / "dist"


def setup_logging(data_dir: Path) -> Path:
    """把运行日志写到数据目录下的 exam_splitter.log,方便排查打包后无控制台时的报错。"""
    data_dir.mkdir(parents=True, exist_ok=True)
    log_path = data_dir / "exam_splitter.log"
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        handlers=[logging.FileHandler(log_path, encoding="utf-8")],
    )
    return log_path


def pick_port(preferred: int = PREFERRED_PORT) -> int:
    """优先占用 8000;被占用时让操作系统分配一个空闲端口。"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        try:
            probe.bind((HOST, preferred))
            return preferred
        except OSError:
            pass
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind((HOST, 0))
        return probe.getsockname()[1]


def build_application(static_dir: Path):
    """导入后端 app 并把前端静态资源挂到根路由,返回可被 uvicorn 运行的 ASGI app。

    导入 `app.main` 必须发生在环境变量设置之后(见模块 docstring)。源码运行时
    需要把 backend 目录加入 `sys.path`;打包后 `app` 包已在 PYZ 里,可直接导入。
    """
    if not is_frozen():
        sys.path.insert(0, str(project_root() / "backend"))

    from app.main import app  # noqa: E402 - 延迟到环境变量就绪后再导入
    from fastapi.staticfiles import StaticFiles  # noqa: E402

    if static_dir.exists():
        # html=True 会在访问 "/" 时返回 index.html;API 路由先注册,匹配优先级更高,
        # 因此挂到 "/" 不会吞掉 /api/*。
        app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="frontend")
    else:
        logging.warning("未找到前端静态目录:%s,将只提供 API。", static_dir)
    return app


class ServerController:
    """封装 uvicorn 在后台线程的启动/停止。"""

    def __init__(self, app, host: str, port: int) -> None:
        """保存运行参数,真正的 Server 在 start() 时才创建。"""
        self._app = app
        self._host = host
        self._port = port
        self._server = None
        self._thread: threading.Thread | None = None

    @property
    def url(self) -> str:
        """本地访问地址。"""
        return f"http://{self._host}:{self._port}"

    def start(self) -> None:
        """在后台线程里启动 uvicorn。屏蔽信号处理(子线程无法注册信号)。"""
        import uvicorn

        config = uvicorn.Config(
            self._app,
            host=self._host,
            port=self._port,
            log_level="info",
            log_config=None,  # 复用 setup_logging 配好的 root logger,日志统一进文件
        )
        self._server = uvicorn.Server(config)
        # 子线程里调用 signal.signal 会抛错,这里直接关掉 uvicorn 的信号处理。
        self._server.install_signal_handlers = lambda: None  # type: ignore[method-assign]

        self._thread = threading.Thread(target=self._server.run, name="uvicorn", daemon=True)
        self._thread.start()

    def wait_until_ready(self, timeout: float = 30.0) -> bool:
        """轮询 uvicorn 的 started 标志,等待服务真正可用。"""
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self._server is not None and getattr(self._server, "started", False):
                return True
            time.sleep(0.1)
        return False

    def stop(self) -> None:
        """通知 uvicorn 退出并等待后台线程结束。"""
        if self._server is not None:
            self._server.should_exit = True
        if self._thread is not None:
            self._thread.join(timeout=5.0)


def run_gui(controller: ServerController, data_dir: Path, log_path: Path) -> None:
    """启动一个极简的 Tk 窗口,提供「打开网页 / 打开数据目录 / 停止并退出」。"""
    import tkinter as tk
    from tkinter import messagebox

    root = tk.Tk()
    root.title("Exam Splitter 试卷切割重组")
    root.geometry("420x220")
    root.resizable(False, False)

    status_var = tk.StringVar(value="正在启动本地服务……")

    tk.Label(root, text="Exam Splitter", font=("Segoe UI", 16, "bold")).pack(pady=(18, 4))
    tk.Label(root, textvariable=status_var, fg="#555").pack(pady=(0, 12))

    button_bar = tk.Frame(root)
    button_bar.pack(pady=4)

    def open_web() -> None:
        """在默认浏览器打开本地网页。"""
        webbrowser.open(controller.url)

    def open_data_dir() -> None:
        """打开数据目录(上传/导出文件与日志所在处)。"""
        try:
            os.startfile(str(data_dir))  # type: ignore[attr-defined] - 仅 Windows 有
        except Exception:  # noqa: BLE001
            messagebox.showinfo("数据目录", str(data_dir))

    open_button = tk.Button(button_bar, text="打开网页", width=14, command=open_web, state=tk.DISABLED)
    open_button.grid(row=0, column=0, padx=6)
    tk.Button(button_bar, text="打开数据目录", width=14, command=open_data_dir).grid(row=0, column=1, padx=6)

    def quit_app() -> None:
        """停止后端并退出整个程序。"""
        status_var.set("正在停止……")
        root.update_idletasks()
        controller.stop()
        root.destroy()

    tk.Button(root, text="停止并退出", width=30, command=quit_app).pack(pady=(14, 6))
    tk.Label(root, text=f"日志:{log_path}", fg="#999", font=("Segoe UI", 8)).pack(side=tk.BOTTOM, pady=6)

    root.protocol("WM_DELETE_WINDOW", quit_app)

    def on_ready() -> None:
        """服务就绪后回到主线程更新界面并自动打开浏览器。"""
        status_var.set(f"服务已就绪:{controller.url}")
        open_button.config(state=tk.NORMAL)
        open_web()

    def on_failed() -> None:
        """启动失败时给出提示并退出。"""
        status_var.set("服务启动失败,请查看日志")
        messagebox.showerror("启动失败", f"本地服务未能启动,详情见日志:\n{log_path}")

    def wait_ready() -> None:
        """后台等待服务就绪,再用 after() 切回主线程刷新 UI。"""
        ok = controller.wait_until_ready()
        root.after(0, on_ready if ok else on_failed)

    threading.Thread(target=wait_ready, name="wait-ready", daemon=True).start()
    root.mainloop()


def main() -> None:
    """程序入口:配置环境 → 启动服务 → 进入启停界面。"""
    data_dir = resolve_data_dir()
    # 必须在导入 app.main 之前设置,storage.py 在导入时读取该变量决定落盘根目录。
    os.environ.setdefault("EXAM_SPLITTER_DATA_DIR", str(data_dir))

    log_path = setup_logging(data_dir)
    logging.info("启动 %s,数据目录=%s,frozen=%s", APP_NAME, data_dir, is_frozen())

    try:
        static_dir = resolve_static_dir()
        application = build_application(static_dir)
        port = pick_port()
        controller = ServerController(application, HOST, port)
        controller.start()
        logging.info("uvicorn 已在 %s 启动", controller.url)
        run_gui(controller, data_dir, log_path)
    except Exception:  # noqa: BLE001 - 顶层兜底,任何异常都落日志
        logging.exception("启动过程中发生未捕获异常")
        raise


if __name__ == "__main__":
    main()
