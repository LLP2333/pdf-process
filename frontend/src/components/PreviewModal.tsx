import { useCallback, useEffect, useRef, useState } from "react";
import { exportFile, previewQuestion } from "../api";
import { applyAdjustmentToQuestion } from "../dividers";
import type { Adjustment, DerivedQuestion } from "../types";

interface Props {
  open: boolean;
  docId: string;
  /** 上传时的原始文件名,用于把导出文件命名为 `<原名>_切割重组.<ext>`。 */
  sourceName: string;
  derivedQuestions: DerivedQuestion[];
  autoTrim: boolean;
  margin: number;
  adjustments: Record<string, Adjustment>;
  onAdjustmentChange: (questionId: string, adj: Adjustment) => void;
  onClose: () => void;
}

type Status = "idle" | "loading" | "ok" | "empty" | "error";

interface Entry {
  url: string | null;
  status: Status;
  message?: string;
  fingerprint: string;
}

const DEBOUNCE_MS = 200;

/**
 * 预览弹窗:把每道题(应用二次裁剪后)纵向拼成 PNG 展示,允许就地微调上下边界。
 *
 * 用户流程:加完分割线 → 点「预览」打开本弹窗 → 看到不满意的题(例如把页码也带上了)
 *   → 拖动「顶部再裁 / 底部再裁」滑块或数字框 → 实时刷新该题预览
 *   → 满意后点底部「导出 PDF / PPTX」一键带走二次裁剪后的产物。
 */
export default function PreviewModal({
  open,
  docId,
  sourceName,
  derivedQuestions,
  autoTrim,
  margin,
  adjustments,
  onAdjustmentChange,
  onClose,
}: Props) {
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [busy, setBusy] = useState<"pdf" | "pptx" | null>(null);
  const [exportMsg, setExportMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const urlsRef = useRef<Set<string>>(new Set());
  const debounceRef = useRef<number | null>(null);

  const loadAll = useCallback(async () => {
    if (!open) return;
    // 先把所有 question 标 loading;旧 url 暂时保留供视觉过渡
    setEntries((prev) => {
      const next: Record<string, Entry> = {};
      for (const q of derivedQuestions) {
        const fp = fingerprintOf(q, adjustments[q.id], autoTrim);
        const old = prev[q.id];
        if (old && old.fingerprint === fp && (old.status === "ok" || old.status === "empty")) {
          next[q.id] = old;
        } else {
          next[q.id] = { url: old?.url ?? null, status: "loading", fingerprint: fp };
        }
      }
      return next;
    });

    for (const q of derivedQuestions) {
      const adj = adjustments[q.id];
      const fp = fingerprintOf(q, adj, autoTrim);
      const adjusted = applyAdjustmentToQuestion(q, adj);
      if (adjusted.segments.length === 0) {
        setEntries((prev) => {
          const old = prev[q.id];
          if (old?.fingerprint !== fp) return prev;
          if (old.url) {
            URL.revokeObjectURL(old.url);
            urlsRef.current.delete(old.url);
          }
          return { ...prev, [q.id]: { url: null, status: "empty", fingerprint: fp } };
        });
        continue;
      }
      try {
        const { url, empty } = await previewQuestion(docId, {
          question: adjusted,
          auto_trim: autoTrim,
        });
        urlsRef.current.add(url);
        setEntries((prev) => {
          const old = prev[q.id];
          if (old?.fingerprint !== fp) {
            URL.revokeObjectURL(url);
            urlsRef.current.delete(url);
            return prev;
          }
          if (old.url) {
            URL.revokeObjectURL(old.url);
            urlsRef.current.delete(old.url);
          }
          return {
            ...prev,
            [q.id]: { url, status: empty ? "empty" : "ok", fingerprint: fp },
          };
        });
      } catch (e: unknown) {
        setEntries((prev) => {
          const old = prev[q.id];
          if (old?.fingerprint !== fp) return prev;
          return {
            ...prev,
            [q.id]: {
              url: null,
              status: "error",
              message: e instanceof Error ? e.message : "预览失败",
              fingerprint: fp,
            },
          };
        });
      }
    }
  }, [open, docId, derivedQuestions, autoTrim, adjustments]);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      loadAll();
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    };
  }, [open, loadAll]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    return () => {
      urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      urlsRef.current.clear();
    };
  }, []);

  async function doExport(format: "pdf" | "pptx") {
    if (busy) return;
    const payloadQuestions = derivedQuestions
      .map((q) => applyAdjustmentToQuestion(q, adjustments[q.id]))
      .filter((q) => q.segments.length > 0);
    if (payloadQuestions.length === 0) {
      setExportMsg({ kind: "err", text: "二次裁剪后没有可导出的题目,请放宽边界" });
      return;
    }
    setBusy(format);
    setExportMsg(null);
    try {
      const { blob, filename, count } = await exportFile(docId, {
        format,
        margin,
        auto_trim: autoTrim,
        source_name: sourceName,
        questions: payloadQuestions,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setExportMsg({ kind: "ok", text: `已导出 ${count} 道题:${filename}` });
    } catch (e: unknown) {
      setExportMsg({ kind: "err", text: e instanceof Error ? e.message : "导出失败" });
    } finally {
      setBusy(null);
    }
  }

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="试卷裁剪预览"
    >
      <div className="modal">
        <div className="modal-head">
          <strong>试卷裁剪预览</strong>
          <span className="modal-sub">{derivedQuestions.length} 道题</span>
          <button className="modal-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="modal-body">
          {derivedQuestions.length === 0 && (
            <div className="modal-empty">还没有任何题目。请在 PDF 上添加至少两条分割线。</div>
          )}
          {derivedQuestions.map((q) => {
            const entry = entries[q.id];
            const adj = adjustments[q.id] ?? { top: 0, bottom: 0 };
            return (
              <div key={q.id} className="modal-card">
                <div className="modal-card-head">
                  <span className="qno">第 {q.no} 题</span>
                  <span className="modal-card-meta">
                    {q.segments.length > 1 ? `跨 ${q.segments.length} 页` : `单页`} ·{" "}
                    {entry?.status === "loading" ? "渲染中…" : "实时预览"}
                  </span>
                </div>

                <div className="modal-card-thumb">
                  {entry?.url && entry.status === "ok" && (
                    <img src={entry.url} alt={`第 ${q.no} 题预览`} />
                  )}
                  {entry?.status === "empty" && (
                    <div className="modal-fallback">裁剪后无内容,请减小再裁的量</div>
                  )}
                  {entry?.status === "error" && (
                    <div className="modal-fallback err">{entry.message ?? "预览失败"}</div>
                  )}
                  {!entry?.url && entry?.status === "loading" && (
                    <div className="modal-fallback">渲染中…</div>
                  )}
                </div>

                <div className="modal-card-adj">
                  <AdjustRow
                    label="顶部再裁(pt)"
                    value={adj.top}
                    onChange={(v) => onAdjustmentChange(q.id, { ...adj, top: v })}
                  />
                  <AdjustRow
                    label="底部再裁(pt)"
                    value={adj.bottom}
                    onChange={(v) => onAdjustmentChange(q.id, { ...adj, bottom: v })}
                  />
                  {(adj.top > 0 || adj.bottom > 0) && (
                    <button
                      className="mini ghost adj-reset"
                      onClick={() => onAdjustmentChange(q.id, { top: 0, bottom: 0 })}
                    >
                      重置
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="modal-foot">
          {exportMsg && <div className={"export-msg " + exportMsg.kind}>{exportMsg.text}</div>}
          <div className="modal-foot-btns">
            <button className="btn" onClick={onClose}>
              关闭
            </button>
            <button
              className="btn"
              onClick={() => doExport("pptx")}
              disabled={busy !== null || derivedQuestions.length === 0}
            >
              {busy === "pptx" ? "导出中…" : "导出 PPTX"}
            </button>
            <button
              className="btn primary"
              onClick={() => doExport("pdf")}
              disabled={busy !== null || derivedQuestions.length === 0}
            >
              {busy === "pdf" ? "导出中…" : "确认并导出 PDF"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// 滑块上限要够大,让跨页题能通过"底部再裁"穿过最后一段、继续吃到前一段;
// 一页 A4 ~842pt,1000pt 足够跨段累积。数字框给到 2000pt 兜底极端情况。
const ADJ_SLIDER_MAX = 1000;
const ADJ_INPUT_MAX = 2000;

function AdjustRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="adj-row">
      <span className="adj-label">{label}</span>
      <input
        type="range"
        min={0}
        max={ADJ_SLIDER_MAX}
        step={1}
        value={Math.min(value, ADJ_SLIDER_MAX)}
        onChange={(e) =>
          onChange(Math.max(0, Math.min(ADJ_SLIDER_MAX, Number(e.target.value) || 0)))
        }
      />
      <input
        type="number"
        min={0}
        max={ADJ_INPUT_MAX}
        step={1}
        value={value}
        onChange={(e) =>
          onChange(Math.max(0, Math.min(ADJ_INPUT_MAX, Number(e.target.value) || 0)))
        }
      />
    </label>
  );
}

function fingerprintOf(
  q: DerivedQuestion,
  adj: Adjustment | undefined,
  autoTrim: boolean,
): string {
  const segs = q.segments
    .map((s) => `${s.page}:${s.y1.toFixed(2)}-${s.y2.toFixed(2)}`)
    .join(",");
  const at = adj?.top ?? 0;
  const ab = adj?.bottom ?? 0;
  return `${q.no}#${autoTrim ? 1 : 0}#${segs}#${at}/${ab}`;
}
