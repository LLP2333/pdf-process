"""pytest 公共夹具:

- `sample_pdf`:伪造一份两页文字 PDF 文件,供各服务测试复用。
- `tmp_storage`:在临时目录里重定向 `storage` 的 BASE_DIR / UPLOAD_DIR / OUTPUT_DIR,
  避免污染仓库自带的 `uploads/`、`outputs/` 目录。
- `client`:基于 FastAPI 的 `TestClient`,依赖 `tmp_storage` 隔离落盘。
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Iterator

import fitz
import pytest
from fastapi.testclient import TestClient

# 让 `import app` 在不安装包的前提下也能工作
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app import storage  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture
def sample_pdf(tmp_path: Path) -> Path:
    """生成一份两页 PDF,每页放几行文字 + 灰色矩形,便于校验切分。"""
    pdf_path = tmp_path / "sample.pdf"
    doc = fitz.open()
    for pno in range(2):
        page = doc.new_page(width=595, height=842)  # A4 portrait
        page.insert_text((72, 80), f"Page {pno + 1} Title", fontsize=20)
        for i in range(6):
            y = 140 + i * 90
            page.insert_text(
                (72, y),
                f"{i + 1 + pno * 6}. Question line {i + 1}",
                fontsize=14,
            )
            page.draw_rect(fitz.Rect(72, y + 10, 520, y + 70), color=(0.7, 0.7, 0.7))
    doc.save(pdf_path.as_posix())
    doc.close()
    return pdf_path


@pytest.fixture
def scan_pdf(tmp_path: Path) -> Path:
    """伪造"扫描件":每页只填一张大灰矩形,几乎无可提取文字层。

    用于验证 `pdf_service.detect_text_layer` 能正确判定"非文字版";
    与 `sample_pdf`(每页有几十个 ASCII 字符)是一对正反例。
    """
    pdf_path = tmp_path / "scan.pdf"
    doc = fitz.open()
    for _ in range(2):
        page = doc.new_page(width=595, height=842)
        # 用矩形 + 大量空白模拟扫描页;一行短文字保留也行,但保持极简,确保字符 < 阈值
        page.draw_rect(fitz.Rect(40, 40, 555, 800), color=(0.85, 0.85, 0.85), fill=(0.9, 0.9, 0.9))
    doc.save(pdf_path.as_posix())
    doc.close()
    return pdf_path


@pytest.fixture
def tmp_storage(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """把 storage 的几个全局路径重定向到 `tmp_path`。"""
    base = tmp_path / "data"
    base.mkdir()
    monkeypatch.setattr(storage, "BASE_DIR", base)
    monkeypatch.setattr(storage, "UPLOAD_DIR", base / "uploads")
    monkeypatch.setattr(storage, "OUTPUT_DIR", base / "outputs")
    storage.ensure_dirs()
    return base


@pytest.fixture
def client(tmp_storage: Path) -> Iterator[TestClient]:
    """注意:必须先依赖 `tmp_storage`,保证 startup 时使用临时目录。"""
    with TestClient(app) as c:
        yield c
