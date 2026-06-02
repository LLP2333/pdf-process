# Exam Splitter

把整张试卷按题号切成「一题一页」的工程版工具。

- **后端**:Python · FastAPI · PyMuPDF · python-pptx
- **前端**:React · Vite · TypeScript · react-konva
- **部署**:Docker Compose

第一阶段聚焦**手动切分**:上传 PDF → 在网页上为每道题拖出**起始 / 结束行** → 一键导出**横版 A4 PDF** 或 **16:9 PPTX**,题区置顶、下方留白方便讲解书写。

## 一键启动(Docker Compose)

```bash
docker compose up -d --build
```

浏览器打开 <http://localhost:8080>。

修改宿主机端口:编辑 [`compose.yaml`](./compose.yaml) 中的 `ports: "8080:80"`。

## 使用步骤

1. 在首页拖入或选择一份**文字型 PDF**,等待数秒解析。
2. 点击侧栏「+ 新增题目」生成第一题,然后在右侧 PDF 上:
   - **双击**任意位置 → 设置当前题的**结束行**(橙色虚线)。
   - **Shift + 双击** → 设置当前题的**起始行**(蓝色虚线)。
   - 拖动两条线右侧的色块手柄可微调位置。
   - 一道题如果跨页,可在另一页点「+ 在本页新建段」追加一段,导出时按段顺序拼接。
3. 在侧栏选中其它题/段切换编辑对象,需要删除时点对应按钮。
4. 调整「页面留白(pt)」后,点击「导出 PDF」或「导出 PPTX」,浏览器会直接下载产物。

## 适用范围

- 仅适用于**文字型(电子生成)PDF**;扫描图片 PDF 切出来也是图片。
- PDF 导出走矢量裁剪,公式 / 表格 / 图形 100% 保留原貌。
- PPTX 把每段以 220 DPI 渲染为 PNG,清晰度足够课堂讲解投影。
- 上传与导出文件保留 24 小时(可改 `EXAM_SPLITTER_RETENTION`)。

## 开发与设计文档

所有面向开发者的内容已收口到 [`docs/`](./docs/):

- [架构总览](./docs/architecture.md)
- [本地开发](./docs/development.md)
- [API 参考](./docs/api.md)
- [测试](./docs/testing.md)
- [变更日志](./docs/CHANGELOG.md)
- [贡献指南](./docs/contributing.md)
