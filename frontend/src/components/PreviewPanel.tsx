import { useEffect, useRef, useState } from "react";
import { previewQuestion } from "../api";
import type { Question } from "../types";

interface Props {
  docId: string;
  questions: Question[];
  autoTrim: boolean;
  activeQuestionIndex: number | null;
  onSelectQuestion: (qi: number) => void;
}

type Status = "idle" | "loading" | "ok" | "empty" | "error";

interface Entry {
  url: string | null;
  status: Status;
  message?: string;
  /** 用于过期请求判定:每次发起请求自增,响应回来比对,只有最新的能写回。 */
  seq: number;
  /** 该次结果对应的输入"指纹",用来跨依赖比较避免重复请求 */
  fingerprint: string;
}

const DEBOUNCE_MS = 250;

/**
 * 右侧实时预览面板。
 *
 * 每当 `questions` / `autoTrim` 变化,以 debounce + 取消式的方式逐题向后端拉取
 * 预览 PNG。每题对应一张拼接后的 PNG(跨页会被纵向拼好),点击缩略图等价于在
 * 中间 PDF 区域选中该题(滚动 + 高亮)。
 */
export default function PreviewPanel({
  docId,
  questions,
  autoTrim,
  activeQuestionIndex,
  onSelectQuestion,
}: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const debounceRef = useRef<number | null>(null);
  const seqRef = useRef(0);
  // 用 ref 跟踪所有发出过的 object URL,组件卸载时统一 revoke
  const urlsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      reloadAll();
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    };
    // questions 引用会变;比较 questions.length 即可触发,但内部 fingerprint 再过滤一遍
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, autoTrim, fingerprintOf(questions)]);

  useEffect(() => {
    return () => {
      urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      urlsRef.current.clear();
    };
  }, []);

  async function reloadAll() {
    const tasks = questions.map((q, qi) => ({ q, qi, fp: fingerprintOfQuestion(q, autoTrim) }));
    setEntries((prev) =>
      tasks.map((t) => {
        const old = prev[t.qi];
        if (old && old.fingerprint === t.fp && (old.status === "ok" || old.status === "empty")) {
          return old;
        }
        return { url: old?.url ?? null, status: "loading", seq: ++seqRef.current, fingerprint: t.fp };
      }),
    );
    for (const t of tasks) {
      // 顺序串行拉取以避免对后端造成瞬时压力(每题渲染开销不小)
      const mySeq = ++seqRef.current;
      try {
        const { url, empty } = await previewQuestion(docId, {
          question: t.q,
          auto_trim: autoTrim,
        });
        urlsRef.current.add(url);
        setEntries((prev) => {
          const next = [...prev];
          // 仅当用户没有再次触发更新(fingerprint 没变)时才写回
          if (next[t.qi]?.fingerprint === t.fp) {
            const old = next[t.qi];
            if (old?.url) {
              URL.revokeObjectURL(old.url);
              urlsRef.current.delete(old.url);
            }
            next[t.qi] = {
              url,
              status: empty ? "empty" : "ok",
              seq: mySeq,
              fingerprint: t.fp,
            };
          } else {
            URL.revokeObjectURL(url);
            urlsRef.current.delete(url);
          }
          return next;
        });
      } catch (e: unknown) {
        setEntries((prev) => {
          const next = [...prev];
          if (next[t.qi]?.fingerprint === t.fp) {
            next[t.qi] = {
              url: null,
              status: "error",
              message: e instanceof Error ? e.message : "预览失败",
              seq: mySeq,
              fingerprint: t.fp,
            };
          }
          return next;
        });
      }
    }
  }

  return (
    <div className="preview">
      <div className="preview-head">
        <strong>实时预览</strong>
        <span className="preview-sub">{questions.length} 题</span>
      </div>
      <div className="preview-body">
        {questions.length === 0 && (
          <div className="preview-empty">添加分割线后,这里会出现每题的实时预览。</div>
        )}
        {questions.map((q, qi) => {
          const entry = entries[qi];
          const active = qi === activeQuestionIndex;
          return (
            <div
              key={qi}
              className={"preview-card" + (active ? " active" : "")}
              onClick={() => onSelectQuestion(qi)}
            >
              <div className="preview-card-head">
                <span className="qno">第 {q.no} 题</span>
                <span className="preview-card-meta">
                  {entry?.status === "loading" ? "渲染中…" : `${q.segments.length} 段`}
                </span>
              </div>
              <div className="preview-card-thumb">
                {entry?.status === "empty" && <div className="preview-fallback">该题无有效内容</div>}
                {entry?.status === "error" && (
                  <div className="preview-fallback err">{entry.message ?? "预览失败"}</div>
                )}
                {entry?.url && entry.status !== "empty" && (
                  <img src={entry.url} alt={`第 ${q.no} 题预览`} />
                )}
                {!entry?.url && entry?.status === "loading" && (
                  <div className="preview-fallback">渲染中…</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function fingerprintOf(qs: Question[]): string {
  // 只看 segments 几何;autoTrim 由 useEffect 的依赖单独触发,无需混进来
  return qs
    .map((q) => q.segments.map((s) => `${s.page}:${s.y1.toFixed(2)}-${s.y2.toFixed(2)}`).join(","))
    .join("|");
}

function fingerprintOfQuestion(q: Question, autoTrim: boolean): string {
  const segs = q.segments
    .map((s) => `${s.page}:${s.y1.toFixed(2)}-${s.y2.toFixed(2)}`)
    .join(",");
  return `${q.no}#${autoTrim ? 1 : 0}#${segs}`;
}
