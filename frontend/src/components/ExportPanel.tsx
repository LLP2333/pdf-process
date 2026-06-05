import { useState } from "react";
import { exportFile } from "../api";
import type { Question } from "../types";

interface Props {
  docId: string;
  questions: Question[];
  autoTrim: boolean;
  onAutoTrimChange: (value: boolean) => void;
}

/**
 * 导出面板:被 App 挂在侧栏顶部。
 *
 * 包含「自动去白边」开关 + 页面留白 + 导出 PDF / PPTX 按钮。
 * 校验:若全部题目都没有有效区域(理论上不会,因为分割线推导至少 1 题),
 * 仍保留兜底校验,失败时直接展示错误文案,不发起请求。
 */
export default function ExportPanel({ docId, questions, autoTrim, onAutoTrimChange }: Props) {
  const [margin, setMargin] = useState(28);
  const [busy, setBusy] = useState<"pdf" | "pptx" | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function go(format: "pdf" | "pptx") {
    if (busy) return;
    const valid = questions.filter((q) => q.segments.length > 0);
    if (valid.length === 0) {
      setMsg({ kind: "err", text: "请先在 PDF 上添加分割线" });
      return;
    }
    setBusy(format);
    setMsg(null);
    try {
      const { blob, filename, count } = await exportFile(docId, {
        format,
        margin,
        auto_trim: autoTrim,
        questions: valid,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setMsg({ kind: "ok", text: `已导出 ${count} 道题:${filename}` });
    } catch (e: unknown) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "导出失败" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="export">
      <div className="export-head">导出</div>
      <label className="export-row">
        <input
          type="checkbox"
          checked={autoTrim}
          onChange={(e) => onAutoTrimChange(e.target.checked)}
        />
        <span>自动去除题目上下白边</span>
      </label>
      <label className="export-row">
        <span>页面留白(pt)</span>
        <input
          type="number"
          min={0}
          max={120}
          step={2}
          value={margin}
          onChange={(e) => setMargin(Number(e.target.value) || 0)}
        />
      </label>
      <div className="export-btns">
        <button className="btn primary" onClick={() => go("pdf")} disabled={busy !== null}>
          {busy === "pdf" ? "导出中…" : "导出 PDF"}
        </button>
        <button className="btn" onClick={() => go("pptx")} disabled={busy !== null}>
          {busy === "pptx" ? "导出中…" : "导出 PPTX"}
        </button>
      </div>
      {msg && <div className={"export-msg " + msg.kind}>{msg.text}</div>}
    </div>
  );
}
