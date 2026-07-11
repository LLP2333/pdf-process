import { useRef } from "react";
import type { DocEntry } from "../types";

interface Props {
  docs: DocEntry[];
  activeDocId: string | null;
  uploading: boolean;
  onSelectDoc: (docId: string) => void;
  /** 追加上传若干 PDF(多选);上传逻辑在 App 层统一处理。 */
  onAddFiles: (files: File[]) => void;
  /** 移除一份文档:其题目区域会被级联清理(App 层确认与处理)。 */
  onRemoveDoc: (docId: string) => void;
}

/**
 * 左侧文档栏:多文档组卷的入口。
 *
 * 每份上传的 PDF 一张卡片,单击切换画布显示的文档;
 * 底部常驻"添加 PDF"按钮与 Word 转换引导文案(本项目不做程序内 Word 转换,
 * Word/WPS 的「另存为 PDF」保真度最高)。
 */
export default function DocumentRail({
  docs,
  activeDocId,
  uploading,
  onSelectDoc,
  onAddFiles,
  onRemoveDoc,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <aside className="doc-rail">
      <div className="doc-rail-head">
        <strong>文档</strong>
        <span className="doc-rail-count">{docs.length}</span>
      </div>
      <div className="doc-rail-list">
        {docs.map((doc, index) => (
          <div
            key={doc.docId}
            className={"doc-card" + (doc.docId === activeDocId ? " active" : "")}
            onClick={() => onSelectDoc(doc.docId)}
            title={doc.filename}
          >
            <span className="doc-card-badge">{String.fromCharCode(65 + (index % 26))}</span>
            <span className="doc-card-body">
              <span className="doc-card-name">{doc.filename}</span>
              <span className="doc-card-meta">{doc.pages.length} 页</span>
            </span>
            <button
              className="doc-card-remove"
              title="移除此文档(其题目区域会一并删除)"
              aria-label={`移除文档 ${doc.filename}`}
              onClick={(e) => {
                e.stopPropagation();
                onRemoveDoc(doc.docId);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="doc-rail-foot">
        <button
          className="btn ghost doc-add-btn"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? "上传中…" : "+ 添加 PDF"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length > 0) onAddFiles(files);
          }}
        />
        <p className="doc-rail-hint">
          Word 文档请先在 Word / WPS 中<b>「另存为 PDF」</b>再上传,排版最保真。
        </p>
      </div>
    </aside>
  );
}
