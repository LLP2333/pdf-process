# Exam Splitter

把整张试卷按题号切成「一题一页」的工程版工具。

- **后端**:Python · FastAPI · PyMuPDF · python-pptx
- **前端**:React · Vite · TypeScript · react-konva
- **部署**:Docker Compose

核心是**做到极致的手动框选**:上传一份或多份 PDF → 在画布上**拖拽画框**圈出每道题(支持左右分栏、跨页、跨试卷组题)→ 右侧实时预览裁剪效果 → 一键导出**横版 A4 PDF** 或 **16:9 PPTX**,一题一页、题区置顶、下方留白方便讲解书写,可选在每页左下角加署名。

## 一键启动(Docker Compose)

```bash
docker compose up -d --build
```

浏览器打开 <http://localhost:8080>。

修改宿主机端口:编辑 [`compose.yaml`](./compose.yaml) 中的 `ports: "8080:80"`。

## 使用步骤

1. 在首页拖入或选择一份/多份 **PDF**(Word 文档请先在 Word/WPS 中「另存为 PDF」),等待数秒解析。
2. 在中央画布上直接操作:
   - **拖拽画框** → 圈出一道题(自动按阅读顺序编号);左右分栏的卷子左右各自框即可。
   - **选中题目的框后 Shift + 拖拽** → 给这道题**追加一块区域**(跨页 / 跨栏 / 跨试卷组题)。
   - 拖动框 = 移动;拖 8 个手柄 = 缩放;**方向键** = 微调(Shift 加速);**Delete** = 删除;**Cmd/Ctrl+Z** = 撤销。
   - 「✨ 自动识别(草稿)」可按题号生成整页宽草稿框,再手动微调(识别仅是辅助)。
3. 右侧题目面板实时显示每题裁剪后的效果,可**拖拽卡片调整题目顺序**、取消勾选跳过某题、删除题目。
4. 左侧文档栏可继续「+ 添加 PDF」,多份试卷之间自由组题。
5. 顶栏「导出设置」调整去白边 / 题目留白 / 页脚署名后,点击「导出 PDF」或「PPTX」,浏览器直接下载产物。

## 适用范围

- 框选裁剪对**文字型与扫描型 PDF 都可用**;但「自动识别题号」仅支持文字型。
- PDF 导出走矢量裁剪,公式 / 表格 / 图形 100% 保留原貌。
- PPTX 把每个区域以 220 DPI 渲染为 PNG,清晰度足够课堂讲解投影。
- 上传与导出文件保留 24 小时(可改 `EXAM_SPLITTER_RETENTION`)。

## 开发与设计文档

所有面向开发者的内容已收口到 [`docs/`](./docs/):

- [架构总览](./docs/architecture.md)
- [本地开发](./docs/development.md)
- [API 参考](./docs/api.md)
- [测试](./docs/testing.md)
- [变更日志](./docs/CHANGELOG.md)
- [贡献指南](./docs/contributing.md)
