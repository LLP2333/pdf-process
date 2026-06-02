import { useRef, useState } from "react";
import { uploadPdf } from "../api";
import type { AppDoc } from "../types";

interface Props {
  onUploaded: (doc: AppDoc) => void;
}

export default function UploadPanel({ onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handle(file: File | null) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("请选择 PDF 文件");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const resp = await uploadPdf(file);
      onUploaded({ docId: resp.doc_id, filename: resp.filename, pages: resp.pages });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "上传失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="upload">
      <div
        className={"drop" + (drag ? " drag" : "") + (busy ? " busy" : "")}
        onClick={() => !busy && inputRef.current?.click()}
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
          if (!busy) handle(e.dataTransfer.files?.[0] ?? null);
        }}
      >
        <div className="drop-icon">📄</div>
        <div className="drop-title">{busy ? "正在解析 PDF…" : "点击选择,或拖拽 PDF 到此处"}</div>
        <div className="drop-sub">仅支持文字型 PDF · 单文件不超过 64MB</div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => handle(e.target.files?.[0] ?? null)}
      />
      {error && <div className="err">{error}</div>}
    </div>
  );
}
