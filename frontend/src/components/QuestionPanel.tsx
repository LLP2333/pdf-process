import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { previewQuestion } from "../api";
import { buildPreviewQuestion } from "../editorState";
import { questionColor } from "../palette";
import type { DocEntry, EditorQuestion, Selection } from "../types";

interface Props {
  questions: EditorQuestion[];
  docs: DocEntry[];
  autoTrim: boolean;
  selection: Selection | null;
  onSelectQuestion: (questionId: string) => void;
  onToggleExcluded: (questionId: string) => void;
  onDeleteQuestion: (questionId: string) => void;
  onMoveQuestion: (fromIndex: number, toIndex: number) => void;
}

type Status = "idle" | "loading" | "ok" | "empty" | "error";

interface Entry {
  url: string | null;
  status: Status;
  message?: string;
  fingerprint: string;
}

const DEBOUNCE_MS = 300;

/**
 * 右侧题目面板:每题一张卡片,常驻实时渲染缩略图(替代旧版预览弹窗)。
 *
 * - 缩略图 = 后端 `/api/preview` 的裁剪结果,所见即所得(含自动去白边);
 * - 卡片可拖拽重排(导出顺序)、勾选"导出"、删除、单击跳转画布;
 * - 预览请求串行 + 防抖 + fingerprint 比对,拖动画布中的框不会打爆后端。
 */
export default function QuestionPanel({
  questions,
  docs,
  autoTrim,
  selection,
  onSelectQuestion,
  onToggleExcluded,
  onDeleteQuestion,
  onMoveQuestion,
}: Props) {
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  // Why ref 镜像:React 18 的 setState updater 惰性执行,串行加载循环里
  // 需要"当下就能读"的最新条目做指纹跳过与过期响应判定,不能依赖 state 闭包。
  const entriesRef = useRef<Record<string, Entry>>({});
  const urlsRef = useRef<Set<string>>(new Set());
  const debounceRef = useRef<number | null>(null);
  const validDocIds = useMemo(() => docs.map((d) => d.docId), [docs]);
  const validDocKey = validDocIds.join(",");

  const patchEntry = useCallback((id: string, entry: Entry | null) => {
    const next = { ...entriesRef.current };
    if (entry === null) delete next[id];
    else next[id] = entry;
    entriesRef.current = next;
    setEntries(next);
  }, []);

  const loadAll = useCallback(async () => {
    // 清理已删除题目的条目与 object URL
    const alive = new Set(questions.map((q) => q.id));
    for (const [id, entry] of Object.entries(entriesRef.current)) {
      if (!alive.has(id)) {
        releaseUrl(urlsRef.current, entry.url);
        patchEntry(id, null);
      }
    }

    for (const q of questions) {
      const fingerprint = fingerprintOf(q, autoTrim, validDocKey);
      const old = entriesRef.current[q.id];
      if (old && old.fingerprint === fingerprint && (old.status === "ok" || old.status === "empty")) {
        continue; // 指纹未变且已有结果 → 跳过,避免无谓重渲染
      }
      patchEntry(q.id, { url: old?.url ?? null, status: "loading", fingerprint });

      const payload = buildPreviewQuestion(q, validDocIds);
      if (!payload) {
        releaseUrl(urlsRef.current, old?.url);
        patchEntry(q.id, { url: null, status: "empty", fingerprint });
        continue;
      }
      try {
        const { url, empty } = await previewQuestion({ question: payload, auto_trim: autoTrim });
        const current = entriesRef.current[q.id];
        if (current?.fingerprint !== fingerprint) {
          // 等待期间题目又变了(或被删):丢弃过期响应
          URL.revokeObjectURL(url);
          continue;
        }
        urlsRef.current.add(url);
        releaseUrl(urlsRef.current, current.url);
        patchEntry(q.id, { url, status: empty ? "empty" : "ok", fingerprint });
      } catch (e: unknown) {
        if (entriesRef.current[q.id]?.fingerprint !== fingerprint) continue;
        patchEntry(q.id, {
          url: null,
          status: "error",
          message: e instanceof Error ? e.message : "预览失败",
          fingerprint,
        });
      }
    }
  }, [questions, autoTrim, validDocIds, validDocKey, patchEntry]);

  useEffect(() => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      loadAll();
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    };
  }, [loadAll]);

  useEffect(() => {
    return () => {
      urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      urlsRef.current.clear();
    };
  }, []);

  const includedCount = questions.reduce((n, q) => (q.excluded ? n : n + 1), 0);
  const multiDoc = docs.length > 1;

  return (
    <aside className="qpanel">
      <div className="qpanel-head">
        <strong>题目</strong>
        <span className="qpanel-count">
          {includedCount === questions.length
            ? `${questions.length} 题`
            : `${includedCount} / ${questions.length} 题将导出`}
        </span>
      </div>
      <div className="qpanel-body">
        {questions.length === 0 && (
          <div className="qpanel-empty">
            还没有题目。
            <br />
            在中间画布上<b>按住鼠标拖拽</b>,框住一道题的范围即可。
            <br />
            <span className="hint">
              跨页/跨栏的题:先选中该题任意框,再按住 <kbd>Shift</kbd> 拖拽补一块区域。
            </span>
          </div>
        )}
        {questions.map((q, index) => {
          const entry = entries[q.id];
          const color = questionColor(index);
          const active = selection?.questionId === q.id;
          const docLabels = Array.from(
            new Set(
              q.regions.map((r) => {
                const di = docs.findIndex((d) => d.docId === r.docId);
                return di === -1 ? "?" : String.fromCharCode(65 + (di % 26));
              }),
            ),
          );
          const firstRegion = q.regions[0];
          const meta = [
            multiDoc ? `卷 ${docLabels.join("+")}` : null,
            firstRegion ? `第 ${firstRegion.page + 1} 页` : null,
            q.regions.length > 1 ? `${q.regions.length} 块区域` : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <div
              key={q.id}
              className={
                "qcard" +
                (active ? " active" : "") +
                (q.excluded ? " excluded" : "") +
                (dropIndex === index && dragIndex !== null && dragIndex !== index
                  ? " drop-target"
                  : "")
              }
              draggable
              onDragStart={(e) => {
                setDragIndex(index);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (dropIndex !== index) setDropIndex(index);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex !== null && dragIndex !== index) onMoveQuestion(dragIndex, index);
                setDragIndex(null);
                setDropIndex(null);
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setDropIndex(null);
              }}
              onClick={() => onSelectQuestion(q.id)}
            >
              <div className="qcard-head">
                <span className="qcard-grip" title="拖拽调整题目顺序" aria-hidden="true">
                  ⠿
                </span>
                <span className="qcard-no" style={{ background: color }}>
                  {index + 1}
                </span>
                <span className="qcard-meta">{meta}</span>
                <span className="qcard-actions">
                  <label
                    className="qcard-toggle"
                    title={q.excluded ? "勾选以加入导出" : "取消勾选则不导出本题"}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={!q.excluded}
                      onChange={() => onToggleExcluded(q.id)}
                      aria-label={`第 ${index + 1} 题是否导出`}
                    />
                  </label>
                  <button
                    className="qcard-delete"
                    title="删除本题(可撤销)"
                    aria-label={`删除第 ${index + 1} 题`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteQuestion(q.id);
                    }}
                  >
                    ×
                  </button>
                </span>
              </div>
              <div className="qcard-thumb">
                {entry?.url && entry.status === "ok" && (
                  <img src={entry.url} alt={`第 ${index + 1} 题预览`} />
                )}
                {entry?.status === "empty" && (
                  <div className="qcard-fallback">区域太小或已失效,无可预览内容</div>
                )}
                {entry?.status === "error" && (
                  <div className="qcard-fallback err">{entry.message ?? "预览失败"}</div>
                )}
                {(!entry || entry.status === "loading") && (
                  <div className={"qcard-fallback" + (entry?.url ? " overlay" : "")}>渲染中…</div>
                )}
                {q.excluded && <div className="qcard-skip-badge">不导出</div>}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function releaseUrl(pool: Set<string>, url: string | null | undefined): void {
  if (!url) return;
  URL.revokeObjectURL(url);
  pool.delete(url);
}

function fingerprintOf(q: EditorQuestion, autoTrim: boolean, docKey: string): string {
  const regions = q.regions
    .map(
      (r) =>
        `${r.docId}:${r.page}:${r.x1.toFixed(2)},${r.y1.toFixed(2)}-${r.x2.toFixed(2)},${r.y2.toFixed(2)}`,
    )
    .join("|");
  return `${autoTrim ? 1 : 0}#${docKey}#${regions}`;
}
