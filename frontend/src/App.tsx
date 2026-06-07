import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import UploadPanel from "./components/UploadPanel";
import PdfPage from "./components/PdfPage";
import QuestionList from "./components/QuestionList";
import ExportPanel from "./components/ExportPanel";
import PreviewModal from "./components/PreviewModal";
import { buildQuestionsFromDividers, newDividerId } from "./dividers";
import type { Adjustment, AppDoc, Divider } from "./types";

const MIN_DIVIDER_GAP_PT = 6;

export default function App() {
  const [doc, setDoc] = useState<AppDoc | null>(null);
  const [dividers, setDividers] = useState<Divider[]>([]);
  const [autoTrim, setAutoTrim] = useState(true);
  const [margin, setMargin] = useState(28);
  const [adjustments, setAdjustments] = useState<Record<string, Adjustment>>({});
  const [activeQuestionIndex, setActiveQuestionIndex] = useState<number | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [sideCollapsed, setSideCollapsed] = useState(false);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const derivedQuestions = useMemo(
    () => (doc ? buildQuestionsFromDividers(dividers, doc.pages) : []),
    [doc, dividers],
  );

  const reset = useCallback(() => {
    setDoc(null);
    setDividers([]);
    setAdjustments({});
    setActiveQuestionIndex(null);
    setShowPreview(false);
  }, []);

  const onUploaded = useCallback((d: AppDoc) => {
    setDoc(d);
    setDividers([]);
    setAdjustments({});
    setActiveQuestionIndex(null);
  }, []);

  const addDivider = useCallback(
    (page: number, y: number) => {
      if (!doc) return;
      const pageInfo = doc.pages[page];
      if (!pageInfo) return;
      const clamped = Math.max(1, Math.min(pageInfo.height - 1, y));
      const tooClose = dividers.some(
        (d) => d.page === page && Math.abs(d.y - clamped) < MIN_DIVIDER_GAP_PT,
      );
      if (tooClose) return;
      setDividers((prev) => [...prev, { id: newDividerId(), page, y: clamped }]);
    },
    [doc, dividers],
  );

  const removeDivider = useCallback((id: string) => {
    setDividers((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const moveDivider = useCallback(
    (id: string, y: number) => {
      if (!doc) return;
      setDividers((prev) =>
        prev.map((d) => {
          if (d.id !== id) return d;
          const pageInfo = doc.pages[d.page];
          if (!pageInfo) return d;
          const clamped = Math.max(1, Math.min(pageInfo.height - 1, y));
          return { ...d, y: clamped };
        }),
      );
    },
    [doc],
  );

  const clearDividers = useCallback(() => {
    setDividers([]);
    setAdjustments({});
    setActiveQuestionIndex(null);
  }, []);

  const handleSelectQuestion = useCallback(
    (qi: number) => {
      setActiveQuestionIndex(qi);
      const q = derivedQuestions[qi];
      const firstSeg = q?.segments[0];
      if (firstSeg) {
        const el = pageRefs.current[firstSeg.page];
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },
    [derivedQuestions],
  );

  const setAdjustmentFor = useCallback((id: string, adj: Adjustment) => {
    setAdjustments((prev) => {
      const next = { ...prev };
      if (adj.top <= 0 && adj.bottom <= 0) delete next[id];
      else next[id] = adj;
      return next;
    });
  }, []);

  useEffect(() => {
    if (activeQuestionIndex !== null && activeQuestionIndex >= derivedQuestions.length) {
      setActiveQuestionIndex(null);
    }
  }, [activeQuestionIndex, derivedQuestions.length]);

  // 清理孤儿 adjustments(对应分割线已被删除)
  useEffect(() => {
    const validIds = new Set(derivedQuestions.map((q) => q.id));
    let dirty = false;
    const next: Record<string, Adjustment> = {};
    for (const [k, v] of Object.entries(adjustments)) {
      if (validIds.has(k)) next[k] = v;
      else dirty = true;
    }
    if (dirty) setAdjustments(next);
  }, [derivedQuestions, adjustments]);

  const pageView = useMemo(() => {
    if (!doc) return null;
    return doc.pages.map((p) => (
      <PdfPage
        key={p.index}
        ref={(el) => {
          pageRefs.current[p.index] = el;
        }}
        page={p}
        dividers={dividers}
        questions={derivedQuestions}
        activeQuestionIndex={activeQuestionIndex}
        onAddDivider={addDivider}
        onRemoveDivider={removeDivider}
        onMoveDivider={moveDivider}
        onSelectQuestion={setActiveQuestionIndex}
      />
    ));
  }, [
    doc,
    dividers,
    derivedQuestions,
    activeQuestionIndex,
    addDivider,
    removeDivider,
    moveDivider,
  ]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">✂︎</span>
          <span>试卷切割重组</span>
        </div>
        {doc && (
          <div className="doc-meta">
            <span>{doc.filename}</span>
            <span className="dot">·</span>
            <span>{doc.pages.length} 页</span>
            <span className="dot">·</span>
            <span>{dividers.length} 条分割线</span>
            <span className="dot">·</span>
            <span>{derivedQuestions.length} 题</span>
            <button className="mini ghost" onClick={reset}>
              重新上传
            </button>
          </div>
        )}
      </header>

      {!doc ? (
        <main className="hero">
          <h1>把整张试卷按题号切成一题一页</h1>
          <p>
            上传一份文字型 PDF,在每道题的<b>开头</b>和<b>结尾</b>各画一条水平分割线,
            两条相邻分割线之间的内容就是一道题。点「预览」可以二次裁剪上下边界
            (例如去掉页眉/页码),最后一键导出 <b>横版 A4 PDF</b> / <b>16:9 PPTX</b>。
          </p>
          <UploadPanel onUploaded={onUploaded} />
        </main>
      ) : (
        <main className={"workspace" + (sideCollapsed ? " side-collapsed" : "")}>
          <aside className={"side side-left" + (sideCollapsed ? " collapsed" : "")}>
            {sideCollapsed ? (
              <button
                className="side-expand"
                onClick={() => setSideCollapsed(false)}
                title="展开导出参数 / 题目面板"
                aria-label="展开导出参数与题目面板"
              >
                <span className="side-expand-icon" aria-hidden="true">
                  ›
                </span>
                <span className="side-expand-text">导出参数 / 题目</span>
              </button>
            ) : (
              <>
                <ExportPanel
                  questionCount={derivedQuestions.length}
                  autoTrim={autoTrim}
                  onAutoTrimChange={setAutoTrim}
                  margin={margin}
                  onMarginChange={setMargin}
                  onOpenPreview={() => setShowPreview(true)}
                  onCollapse={() => setSideCollapsed(true)}
                />
                <QuestionList
                  questions={derivedQuestions}
                  activeQuestionIndex={activeQuestionIndex}
                  onSelectQuestion={handleSelectQuestion}
                  onClearDividers={clearDividers}
                  dividerCount={dividers.length}
                  adjustments={adjustments}
                />
              </>
            )}
          </aside>
          <section className="pages">{pageView}</section>
        </main>
      )}

      {doc && (
        <PreviewModal
          open={showPreview}
          docId={doc.docId}
          sourceName={doc.filename}
          derivedQuestions={derivedQuestions}
          autoTrim={autoTrim}
          margin={margin}
          adjustments={adjustments}
          onAdjustmentChange={setAdjustmentFor}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  );
}
