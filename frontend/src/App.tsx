import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { autoDetect, exportFile, uploadPdf, type ExportFormat } from "./api";
import DocumentRail from "./components/DocumentRail";
import PageCanvas, { type CanvasRegion } from "./components/PageCanvas";
import QuestionPanel from "./components/QuestionPanel";
import TopBar from "./components/TopBar";
import UploadPanel from "./components/UploadPanel";
import {
  addQuestionWithRegion,
  appendRegionToQuestion,
  buildExportQuestions,
  canRedo,
  canUndo,
  commit,
  commitFrom,
  deleteQuestion,
  deleteRegion,
  draftQuestionsFromDividers,
  emptyHistory,
  insertQuestionSorted,
  moveQuestion,
  newId,
  redo,
  removeDocRegions,
  replacePresent,
  toggleQuestionExcluded,
  undo,
  updateRegionRect,
  type History,
} from "./editorState";
import { questionColor } from "./palette";
import type { DocEntry, EditorQuestion, EditorRegion, Selection } from "./types";

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.25;

interface Toast {
  kind: "ok" | "err";
  text: string;
}

interface AutoDetectMessage {
  text: string;
  tone: "info" | "warn" | "error";
}

export default function App() {
  const [docs, setDocs] = useState<DocEntry[]>([]);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [history, setHistory] = useState<History>(() => emptyHistory());
  const [selection, setSelection] = useState<Selection | null>(null);
  const [zoom, setZoom] = useState(1);
  const [shiftDown, setShiftDown] = useState(false);

  const [autoTrim, setAutoTrim] = useState(true);
  const [bottomSpace, setBottomSpace] = useState(5);
  const [footerText, setFooterText] = useState("");
  const [footerSize, setFooterSize] = useState(8);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState<ExportFormat | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [autoDetectMessage, setAutoDetectMessage] = useState<AutoDetectMessage | null>(null);

  const pageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const pendingScrollRef = useRef<{ docId: string; page: number } | null>(null);
  // 方向键微调手势:首次按键记住"变更前快照",keyup 时一次性入历史
  const arrowGestureRef = useRef<EditorQuestion[] | null>(null);

  const questions = history.present;
  const activeDoc = docs.find((d) => d.docId === activeDocId) ?? null;
  const docOrder = useMemo(() => docs.map((d) => d.docId), [docs]);

  const exportQuestions = useMemo(
    () => buildExportQuestions(questions, docOrder),
    [questions, docOrder],
  );

  // ---------------------------------------------------------------------
  // 上传(首屏与文档栏共用)
  // ---------------------------------------------------------------------

  const handleFiles = useCallback(
    async (files: File[]) => {
      const pdfs = files.filter((f) => f.name.toLowerCase().endsWith(".pdf"));
      const skipped = files.length - pdfs.length;
      const errors: string[] = [];
      if (skipped > 0) {
        errors.push(`已跳过 ${skipped} 个非 PDF 文件(Word 请先「另存为 PDF」)`);
      }
      if (pdfs.length === 0) {
        if (docs.length === 0) setUploadError(errors[0] ?? "请选择 PDF 文件");
        else setToast({ kind: "err", text: errors[0] ?? "请选择 PDF 文件" });
        return;
      }
      setUploading(true);
      setUploadError(null);
      const added: DocEntry[] = [];
      for (const file of pdfs) {
        try {
          const resp = await uploadPdf(file);
          added.push({ docId: resp.doc_id, filename: resp.filename, pages: resp.pages });
        } catch (e: unknown) {
          errors.push(`${file.name}:${e instanceof Error ? e.message : "上传失败"}`);
        }
      }
      setUploading(false);
      if (added.length > 0) {
        setDocs((prev) => [...prev, ...added]);
        setActiveDocId((cur) => cur ?? added[0].docId);
      }
      if (errors.length > 0) {
        const text = errors.join(" ; ");
        if (docs.length === 0 && added.length === 0) setUploadError(text);
        else setToast({ kind: "err", text });
      }
    },
    [docs.length],
  );

  const handleRemoveDoc = useCallback(
    (docId: string) => {
      const remaining = docs.filter((d) => d.docId !== docId);
      setDocs(remaining);
      if (activeDocId === docId) setActiveDocId(remaining[0]?.docId ?? null);
      // Why 重置历史:若保留撤销栈,undo 会复活引用已删文档的"孤儿区域"
      setHistory((h) => emptyHistory(removeDocRegions(h.present, docId)));
      setSelection(null);
      setAutoDetectMessage(null);
    },
    [docs, activeDocId],
  );

  // ---------------------------------------------------------------------
  // 画布交互:画框 / 选中 / 移动缩放提交
  // ---------------------------------------------------------------------

  const handleDrawRegion = useCallback(
    (rect: { page: number; x1: number; y1: number; x2: number; y2: number }, append: boolean) => {
      if (!activeDocId) return;
      const region: EditorRegion = {
        id: newId("r"),
        docId: activeDocId,
        page: rect.page,
        x1: rect.x1,
        y1: rect.y1,
        x2: rect.x2,
        y2: rect.y2,
      };
      const appendTargetId =
        append && selection && questions.some((q) => q.id === selection.questionId)
          ? selection.questionId
          : null;
      if (appendTargetId) {
        setHistory((h) => commit(h, appendRegionToQuestion(h.present, appendTargetId, region)));
        setSelection({ questionId: appendTargetId, regionId: region.id });
        return;
      }
      const questionId = newId("q");
      setHistory((h) => commit(h, addQuestionWithRegion(h.present, region, questionId, docOrder)));
      setSelection({ questionId, regionId: region.id });
    },
    [activeDocId, selection, questions, docOrder],
  );

  const handleRegionCommit = useCallback(
    (regionId: string, rect: { x1: number; y1: number; x2: number; y2: number }) => {
      setHistory((h) => commit(h, updateRegionRect(h.present, regionId, rect)));
    },
    [],
  );

  const handleSelectRegion = useCallback((sel: Selection) => {
    setSelection(sel);
  }, []);

  const handleDeselect = useCallback(() => setSelection(null), []);

  // 选中项失效清理(撤销/删除后区域可能已不存在)
  useEffect(() => {
    if (!selection) return;
    const alive = questions.some(
      (q) => q.id === selection.questionId && q.regions.some((r) => r.id === selection.regionId),
    );
    if (!alive) setSelection(null);
  }, [questions, selection]);

  // ---------------------------------------------------------------------
  // 键盘:撤销重做 / 删除 / 方向键微调 / Shift 状态
  // ---------------------------------------------------------------------

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      return (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShiftDown(true);
      if (isEditableTarget(e.target)) return;

      const meta = e.metaKey || e.ctrlKey;
      if (meta && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        setHistory((h) => (e.shiftKey ? redo(h) : undo(h)));
        return;
      }
      if (meta && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        setHistory((h) => redo(h));
        return;
      }
      if (e.key === "Escape") {
        setSelection(null);
        return;
      }
      if (!selection) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        setHistory((h) => commit(h, deleteRegion(h.present, selection.regionId)));
        setSelection(null);
        return;
      }

      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const delta = arrows[e.key];
      if (!delta) return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = delta[0] * step;
      const dy = delta[1] * step;
      setHistory((h) => {
        const question = h.present.find((q) => q.id === selection.questionId);
        const region = question?.regions.find((r) => r.id === selection.regionId);
        if (!region) return h;
        const doc = docs.find((d) => d.docId === region.docId);
        const pageInfo = doc?.pages[region.page];
        if (!pageInfo) return h;
        const w = region.x2 - region.x1;
        const hgt = region.y2 - region.y1;
        const x1 = Math.max(0, Math.min(pageInfo.width - w, region.x1 + dx));
        const y1 = Math.max(0, Math.min(pageInfo.height - hgt, region.y1 + dy));
        if (x1 === region.x1 && y1 === region.y1) return h;
        if (arrowGestureRef.current === null) arrowGestureRef.current = h.present;
        return replacePresent(
          h,
          updateRegionRect(h.present, region.id, { x1, y1, x2: x1 + w, y2: y1 + hgt }),
        );
      });
    };

    const flushArrowGesture = () => {
      const before = arrowGestureRef.current;
      if (before === null) return;
      arrowGestureRef.current = null;
      setHistory((h) => commitFrom(h, before));
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShiftDown(false);
      if (e.key.startsWith("Arrow")) flushArrowGesture();
    };
    const onBlur = () => {
      setShiftDown(false);
      flushArrowGesture();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [selection, docs]);

  // ---------------------------------------------------------------------
  // 题目面板 → 画布联动
  // ---------------------------------------------------------------------

  const scrollToPage = useCallback(
    (docId: string, page: number) => {
      if (docId !== activeDocId) {
        pendingScrollRef.current = { docId, page };
        setActiveDocId(docId);
        return;
      }
      pageRefs.current[`${docId}:${page}`]?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [activeDocId],
  );

  useEffect(() => {
    const pending = pendingScrollRef.current;
    if (!pending || pending.docId !== activeDocId) return;
    pendingScrollRef.current = null;
    requestAnimationFrame(() => {
      pageRefs.current[`${pending.docId}:${pending.page}`]?.scrollIntoView({ block: "start" });
    });
  }, [activeDocId]);

  const handleSelectQuestion = useCallback(
    (questionId: string) => {
      const question = questions.find((q) => q.id === questionId);
      const first = question?.regions[0];
      if (!question || !first) return;
      setSelection({ questionId, regionId: first.id });
      scrollToPage(first.docId, first.page);
    },
    [questions, scrollToPage],
  );

  const handleToggleExcluded = useCallback((questionId: string) => {
    setHistory((h) => commit(h, toggleQuestionExcluded(h.present, questionId)));
  }, []);

  const handleDeleteQuestion = useCallback((questionId: string) => {
    setHistory((h) => commit(h, deleteQuestion(h.present, questionId)));
  }, []);

  const handleMoveQuestion = useCallback((fromIndex: number, toIndex: number) => {
    setHistory((h) => commit(h, moveQuestion(h.present, fromIndex, toIndex)));
  }, []);

  // ---------------------------------------------------------------------
  // 自动识别(辅助功能):对当前文档生成整页宽草稿题框
  // ---------------------------------------------------------------------

  const handleAutoDetect = useCallback(async () => {
    if (!activeDoc) return;
    setAutoDetecting(true);
    setAutoDetectMessage(null);
    try {
      const result = await autoDetect(activeDoc.docId);
      if (!result.is_text) {
        setAutoDetectMessage({ text: result.message, tone: "error" });
        return;
      }
      if (result.dividers.length === 0) {
        setAutoDetectMessage({ text: result.message, tone: "warn" });
        return;
      }
      const drafts = draftQuestionsFromDividers(
        result.dividers,
        activeDoc.docId,
        activeDoc.pages,
        () => newId("a"),
      );
      setHistory((h) => {
        // 只替换"完全属于当前文档"的题;跨文档组合的题保留
        const kept = h.present.filter((q) => !q.regions.every((r) => r.docId === activeDoc.docId));
        let next = kept;
        for (const draft of drafts) {
          next = insertQuestionSorted(next, draft, docOrder);
        }
        return commit(h, next);
      });
      setSelection(null);
      setAutoDetectMessage({
        text: `${result.message}(草稿框已生成,可直接拖动/缩放微调)`,
        tone: "info",
      });
    } catch (e: unknown) {
      setAutoDetectMessage({
        text: e instanceof Error ? e.message : "自动识别失败",
        tone: "error",
      });
    } finally {
      setAutoDetecting(false);
    }
  }, [activeDoc, docOrder]);

  // ---------------------------------------------------------------------
  // 导出
  // ---------------------------------------------------------------------

  const doExport = useCallback(
    async (format: ExportFormat) => {
      if (exportBusy) return;
      if (exportQuestions.length === 0) {
        setToast({ kind: "err", text: "没有可导出的题目:请先在画布上框选题目" });
        return;
      }
      setExportBusy(format);
      try {
        const { blob, filename, count } = await exportFile({
          format,
          bottom_space: bottomSpace,
          auto_trim: autoTrim,
          footer_text: footerText.trim() || undefined,
          footer_size: footerSize,
          source_name: docs[0]?.filename,
          questions: exportQuestions,
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        setToast({ kind: "ok", text: `已导出 ${count} 道题:${filename}` });
      } catch (e: unknown) {
        setToast({ kind: "err", text: e instanceof Error ? e.message : "导出失败" });
      } finally {
        setExportBusy(null);
      }
    },
    [exportBusy, exportQuestions, bottomSpace, autoTrim, footerText, footerSize, docs],
  );

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // ---------------------------------------------------------------------
  // 画布数据:当前文档每页的区域视图
  // ---------------------------------------------------------------------

  const regionsByPage = useMemo(() => {
    const map = new Map<number, CanvasRegion[]>();
    if (!activeDocId) return map;
    questions.forEach((q, qi) => {
      q.regions.forEach((r, ri) => {
        if (r.docId !== activeDocId) return;
        const list = map.get(r.page) ?? [];
        list.push({
          region: r,
          questionId: q.id,
          questionIndex: qi,
          regionIndex: ri,
          color: questionColor(qi),
        });
        map.set(r.page, list);
      });
    });
    return map;
  }, [questions, activeDocId]);

  const hasDocs = docs.length > 0;

  return (
    <div className="app">
      <TopBar
        hasDocs={hasDocs}
        canUndo={canUndo(history)}
        canRedo={canRedo(history)}
        onUndo={() => setHistory(undo)}
        onRedo={() => setHistory(redo)}
        autoTrim={autoTrim}
        onAutoTrimChange={setAutoTrim}
        bottomSpace={bottomSpace}
        onBottomSpaceChange={setBottomSpace}
        footerText={footerText}
        onFooterTextChange={setFooterText}
        footerSize={footerSize}
        onFooterSizeChange={setFooterSize}
        includedCount={exportQuestions.length}
        exportBusy={exportBusy}
        onExport={doExport}
      />

      {!hasDocs ? (
        <main className="hero">
          <h1>框选题目,自由重组你的试卷</h1>
          <p>
            上传一份或多份 PDF 试卷,在页面上<b>拖拽画框</b>圈出每道题
            (支持左右分栏、跨页、跨试卷组题),右侧实时预览裁剪效果,
            一键导出<b>横版 A4 PDF</b> / <b>16:9 PPTX</b>,一题一页。
          </p>
          <UploadPanel uploading={uploading} error={uploadError} onFiles={handleFiles} />
        </main>
      ) : (
        <main className="workspace">
          <DocumentRail
            docs={docs}
            activeDocId={activeDocId}
            uploading={uploading}
            onSelectDoc={(id) => setActiveDocId(id)}
            onAddFiles={handleFiles}
            onRemoveDoc={handleRemoveDoc}
          />

          <section className="canvas-area">
            <div className="canvas-toolbar">
              <div className="zoom-ctl">
                <button
                  className="icon-btn"
                  onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))}
                  disabled={zoom <= ZOOM_MIN}
                  aria-label="缩小"
                >
                  −
                </button>
                <span className="zoom-val">{Math.round(zoom * 100)}%</span>
                <button
                  className="icon-btn"
                  onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))}
                  disabled={zoom >= ZOOM_MAX}
                  aria-label="放大"
                >
                  +
                </button>
              </div>
              <button
                className="btn ghost mini-detect"
                onClick={handleAutoDetect}
                disabled={autoDetecting || !activeDoc}
                title="识别行首题号,生成整页宽草稿框(识别结果需手动微调)"
              >
                {autoDetecting ? "识别中…" : "✨ 自动识别(草稿)"}
              </button>
              {autoDetectMessage && (
                <span className={`detect-msg detect-${autoDetectMessage.tone}`}>
                  {autoDetectMessage.text}
                </span>
              )}
              <div className="canvas-hint">
                拖拽 = 框选一题 · <kbd>Shift</kbd>+拖拽 = 给选中题补区域 · <kbd>Delete</kbd> = 删除 ·
                方向键 = 微调
              </div>
            </div>
            <div className="canvas-scroll">
              {activeDoc?.pages.map((p) => (
                <PageCanvas
                  key={`${activeDoc.docId}:${p.index}`}
                  ref={(el) => {
                    pageRefs.current[`${activeDoc.docId}:${p.index}`] = el;
                  }}
                  page={p}
                  zoom={zoom}
                  regions={regionsByPage.get(p.index) ?? []}
                  selection={selection}
                  shiftDown={shiftDown}
                  onDrawRegion={handleDrawRegion}
                  onSelectRegion={handleSelectRegion}
                  onDeselect={handleDeselect}
                  onRegionCommit={handleRegionCommit}
                />
              ))}
            </div>
          </section>

          <QuestionPanel
            questions={questions}
            docs={docs}
            autoTrim={autoTrim}
            selection={selection}
            onSelectQuestion={handleSelectQuestion}
            onToggleExcluded={handleToggleExcluded}
            onDeleteQuestion={handleDeleteQuestion}
            onMoveQuestion={handleMoveQuestion}
          />
        </main>
      )}

      {toast && <div className={`toast toast-${toast.kind}`}>{toast.text}</div>}
    </div>
  );
}
