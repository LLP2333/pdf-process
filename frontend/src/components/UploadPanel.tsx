import { useRef, useState } from "react";

interface Props {
  uploading: boolean;
  error: string | null;
  /** 用户选择/拖入若干文件;实际上传由 App 统一处理(与文档栏共用逻辑)。 */
  onFiles: (files: File[]) => void;
}

/**
 * 首屏上传区:支持多选 / 拖拽多个 PDF。
 *
 * 只负责收集文件,不做上传 —— 上传状态与错误由 App 传入,
 * 保证与左侧文档栏"添加 PDF"走同一条代码路径。
 */
export default function UploadPanel({ uploading, error, onFiles }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  return (
    <div className="upload">
      <div
        className={"drop" + (drag ? " drag" : "") + (uploading ? " busy" : "")}
        onClick={() => !uploading && inputRef.current?.click()}
        onDragEnter={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDrag(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (uploading) return;
          const files = Array.from(e.dataTransfer.files ?? []);
          if (files.length > 0) onFiles(files);
        }}
      >
        <div className="drop-icon">📄</div>
        <div className="drop-title">
          {uploading ? "正在解析 PDF…" : "点击选择,或拖拽 PDF 到此处"}
        </div>
        <div className="drop-sub">支持一次选择多份试卷 · 单文件不超过 64MB</div>
        <div className="drop-word-hint">
          Word 文档请先在 Word / WPS 中「另存为 PDF」再上传,排版最保真
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length > 0) onFiles(files);
        }}
      />
      {error && <div className="err">{error}</div>}
    </div>
  );
}
