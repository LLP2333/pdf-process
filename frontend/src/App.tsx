import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import UploadPanel from "./components/UploadPanel";
import PdfPage from "./components/PdfPage";
import QuestionList from "./components/QuestionList";
import ExportPanel from "./components/ExportPanel";
import PreviewPanel from "./components/PreviewPanel";
import { buildQuestionsFromDividers, newDividerId } from "./dividers";
import type { AppDoc, Divider } from "./types";

const MIN_DIVIDER_GAP_PT = 6; // 同页两条分割线最小间距(pt),避免误点

export default function App() {
  const [doc, setDoc] = useState<AppDoc | null>(null);
  const [dividers, setDividers] = useState<Divider[]>([]);
  const [autoTrim, setAutoTrim] = useState(true);
  const [activeQuestionIndex, setActiveQuestionIndex] = useState<number | null>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const questions = useMemo(
    () => (doc ? buildQuestionsFromDividers(dividers, doc.pages) : []),
    [doc, dividers],
  );

  const reset = useCallback(() => {
    setDoc(null);
    setDividers([]);
    setActiveQuestionIndex(null);
  }, []);

  const onUploaded = useCallback((d: AppDoc) => {
    setDoc(d);
    setDividers([]);
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
    setActiveQuestionIndex(null);
  }, []);

  const handleSelectQuestion = useCallback(
    (qi: number) => {
      setActiveQuestionIndex(qi);
      const q = questions[qi];
      const firstSeg = q?.segments[0];
      if (firstSeg) {
        const el = pageRefs.current[firstSeg.page];
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },
    [questions],
  );

  useEffect(() => {
    if (activeQuestionIndex !== null && activeQuestionIndex >= questions.length) {
      setActiveQuestionIndex(null);
    }
  }, [activeQuestionIndex, questions.length]);

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
        questions={questions}
        activeQuestionIndex={activeQuestionIndex}
        onAddDivider={addDivider}
        onRemoveDivider={removeDivider}
        onMoveDivider={moveDivider}
        onSelectQuestion={setActiveQuestionIndex}
      />
    ));
  }, [doc, dividers, questions, activeQuestionIndex, addDivider, removeDivider, moveDivider]);

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
            <span>{questions.length} 题</span>
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
            上传一份文字型 PDF,在每道题的<b>分界处单击鼠标</b>即可加一条分割线,
            拖动调整位置、Shift+单击 或 × 删除。两条分割线之间就是一道题,
            后端会自动裁掉上下白边并导出 <b>横版 A4 PDF</b> / <b>16:9 PPTX</b>。
          </p>
          <UploadPanel onUploaded={onUploaded} />
        </main>
      ) : (
        <main className="workspace">
          <aside className="side side-left">
            <ExportPanel
              docId={doc.docId}
              questions={questions}
              autoTrim={autoTrim}
              onAutoTrimChange={setAutoTrim}
            />
            <QuestionList
              questions={questions}
              activeQuestionIndex={activeQuestionIndex}
              onSelectQuestion={handleSelectQuestion}
              onClearDividers={clearDividers}
              dividerCount={dividers.length}
            />
          </aside>
          <section className="pages">{pageView}</section>
          <aside className="side side-right">
            <PreviewPanel
              docId={doc.docId}
              questions={questions}
              autoTrim={autoTrim}
              activeQuestionIndex={activeQuestionIndex}
              onSelectQuestion={handleSelectQuestion}
            />
          </aside>
        </main>
      )}
    </div>
  );
}
