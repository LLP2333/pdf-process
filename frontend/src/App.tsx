import { useMemo, useState } from "react";
import UploadPanel from "./components/UploadPanel";
import PdfPage from "./components/PdfPage";
import QuestionList from "./components/QuestionList";
import ExportPanel from "./components/ExportPanel";
import type { AppDoc, Question } from "./types";

export default function App() {
  const [doc, setDoc] = useState<AppDoc | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [activeQuestion, setActiveQuestion] = useState<number | null>(null);
  const [activeSegment, setActiveSegment] = useState<number | null>(null);

  function reset() {
    setDoc(null);
    setQuestions([]);
    setActiveQuestion(null);
    setActiveSegment(null);
  }

  function addQuestion() {
    const nextNo = (questions[questions.length - 1]?.no ?? 0) + 1;
    setQuestions((prev) => {
      const next = [...prev, { no: nextNo, segments: [] }];
      setActiveQuestion(next.length - 1);
      setActiveSegment(null);
      return next;
    });
  }

  function removeQuestion(qi: number) {
    setQuestions((prev) => prev.filter((_, i) => i !== qi));
    setActiveQuestion(null);
    setActiveSegment(null);
  }

  function removeSegment(qi: number, si: number) {
    setQuestions((prev) =>
      prev.map((q, i) => (i === qi ? { ...q, segments: q.segments.filter((_, j) => j !== si) } : q))
    );
    setActiveSegment(null);
  }

  function selectSegment(qi: number, si: number) {
    setActiveQuestion(qi);
    setActiveSegment(si);
  }

  function renumber() {
    setQuestions((prev) => prev.map((q, i) => ({ ...q, no: i + 1 })));
  }

  function addSegmentInPage(page: number) {
    if (activeQuestion === null || !doc) {
      addQuestionAndAddSegment(page);
      return;
    }
    const pageInfo = doc.pages[page];
    if (!pageInfo) return;
    const y1 = pageInfo.height * 0.1;
    const y2 = pageInfo.height * 0.4;
    let newSegIdx = 0;
    setQuestions((prev) =>
      prev.map((q, i) => {
        if (i !== activeQuestion) return q;
        newSegIdx = q.segments.length;
        return { ...q, segments: [...q.segments, { page, y1, y2 }] };
      })
    );
    setActiveSegment(newSegIdx);
  }

  function addQuestionAndAddSegment(page: number) {
    if (!doc) return;
    const pageInfo = doc.pages[page];
    if (!pageInfo) return;
    const nextNo = (questions[questions.length - 1]?.no ?? 0) + 1;
    const seg = { page, y1: pageInfo.height * 0.1, y2: pageInfo.height * 0.4 };
    setQuestions((prev) => {
      const next = [...prev, { no: nextNo, segments: [seg] }];
      setActiveQuestion(next.length - 1);
      setActiveSegment(0);
      return next;
    });
  }

  function clickPage(page: number, yPdf: number, shift: boolean) {
    if (activeQuestion === null) {
      addQuestionAndAddSegment(page);
      return;
    }
    setQuestions((prev) => {
      const next = prev.map((q) => ({ ...q, segments: [...q.segments] }));
      const q = next[activeQuestion];
      // 找当前题在该页是否已有段;没有就新建一段
      let segIdx = q.segments.findIndex((s) => s.page === page);
      if (segIdx === -1) {
        const seg = { page, y1: shift ? yPdf : Math.max(0, yPdf - 60), y2: shift ? Math.min(yPdf + 60, doc!.pages[page].height) : yPdf };
        q.segments.push(seg);
        segIdx = q.segments.length - 1;
      } else {
        const seg = { ...q.segments[segIdx] };
        if (shift) seg.y1 = yPdf;
        else seg.y2 = yPdf;
        // 保持 y1 < y2
        if (seg.y1 > seg.y2) {
          const t = seg.y1;
          seg.y1 = seg.y2;
          seg.y2 = t;
        }
        q.segments[segIdx] = seg;
      }
      setActiveSegment(segIdx);
      return next;
    });
  }

  function dragLine(qi: number, si: number, edge: "y1" | "y2", yPdf: number) {
    setQuestions((prev) =>
      prev.map((q, i) => {
        if (i !== qi) return q;
        const segs = q.segments.map((s, j) => {
          if (j !== si) return s;
          const ns = { ...s, [edge]: yPdf } as typeof s;
          if (ns.y1 > ns.y2) {
            const t = ns.y1;
            ns.y1 = ns.y2;
            ns.y2 = t;
          }
          return ns;
        });
        return { ...q, segments: segs };
      })
    );
    setActiveQuestion(qi);
    setActiveSegment(si);
  }

  const pageView = useMemo(() => {
    if (!doc) return null;
    return doc.pages.map((p) => (
      <PdfPage
        key={p.index}
        page={p}
        questions={questions}
        activeQuestion={activeQuestion}
        activeSegment={activeSegment}
        onClickPage={clickPage}
        onDragLine={dragLine}
        onAddSegmentInPage={addSegmentInPage}
        onSelectSegment={selectSegment}
      />
    ));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, questions, activeQuestion, activeSegment]);

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
            上传一份文字型 PDF,然后在每道题上双击设置<b>结束行</b>(Shift+双击 设置<b>起始行</b>),
            导出为<b>横版 A4 PDF</b> 或 <b>16:9 PPTX</b>,方便课堂讲解与书写。
          </p>
          <UploadPanel onUploaded={setDoc} />
        </main>
      ) : (
        <main className="workspace">
          <aside className="side">
            <QuestionList
              questions={questions}
              activeQuestion={activeQuestion}
              activeSegment={activeSegment}
              onSelectSegment={selectSegment}
              onAddQuestion={addQuestion}
              onRemoveQuestion={removeQuestion}
              onRemoveSegment={removeSegment}
              onRenumber={renumber}
            />
            <ExportPanel docId={doc.docId} questions={questions} />
          </aside>
          <section className="pages">{pageView}</section>
        </main>
      )}
    </div>
  );
}
