import { useEffect, useRef, useState } from "react";
import type { ExportFormat } from "../api";

interface Props {
  hasDocs: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  autoTrim: boolean;
  onAutoTrimChange: (value: boolean) => void;
  /** 题目下方留白,占页高百分比(0-80),与后端 `bottom_space` 对齐。 */
  bottomSpace: number;
  onBottomSpaceChange: (value: number) => void;
  footerText: string;
  onFooterTextChange: (value: string) => void;
  /** 署名字号(pt),与后端 `footer_size` 对齐(6-24)。 */
  footerSize: number;
  onFooterSizeChange: (value: number) => void;
  /** 将参与导出的题目数(排除 excluded 与空区域后)。 */
  includedCount: number;
  exportBusy: ExportFormat | null;
  onExport: (format: ExportFormat) => void;
}

/**
 * 顶栏:品牌 + 撤销/重做 + 导出设置(弹出面板)+ 导出按钮。
 *
 * 导出设置(去白边 / 题目留白 / 页脚署名)集中放在一个小弹层里,
 * 避免常驻表单挤占画布空间 —— 这些参数一次设置后很少反复改。
 */
export default function TopBar({
  hasDocs,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  autoTrim,
  onAutoTrimChange,
  bottomSpace,
  onBottomSpaceChange,
  footerText,
  onFooterTextChange,
  footerSize,
  onFooterSizeChange,
  includedCount,
  exportBusy,
  onExport,
}: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // 点击弹层外部时收起
  useEffect(() => {
    if (!settingsOpen) return;
    const onDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [settingsOpen]);

  const exportDisabled = includedCount === 0 || exportBusy !== null;

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-logo">✂︎</span>
        <span className="brand-name">试卷切割重组</span>
      </div>

      {hasDocs && (
        <div className="topbar-history">
          <button
            className="icon-btn"
            onClick={onUndo}
            disabled={!canUndo}
            title="撤销 (Cmd/Ctrl+Z)"
            aria-label="撤销"
          >
            ↶
          </button>
          <button
            className="icon-btn"
            onClick={onRedo}
            disabled={!canRedo}
            title="重做 (Shift+Cmd/Ctrl+Z)"
            aria-label="重做"
          >
            ↷
          </button>
        </div>
      )}

      <div className="topbar-spacer" />

      {hasDocs && (
        <div className="topbar-export">
          <div className="settings-wrap" ref={popoverRef}>
            <button
              className={"btn ghost" + (settingsOpen ? " on" : "")}
              onClick={() => setSettingsOpen((v) => !v)}
              title="导出设置"
            >
              导出设置
            </button>
            {settingsOpen && (
              <div className="settings-pop">
                <label className="settings-row">
                  <input
                    type="checkbox"
                    checked={autoTrim}
                    onChange={(e) => onAutoTrimChange(e.target.checked)}
                  />
                  <span>自动去除区域四周白边</span>
                </label>
                <label
                  className="settings-row settings-col"
                  title="题目下方至少预留的空白,占页高的百分比;调大后题目会缩小,留出作答空间。左右和顶部固定留白"
                >
                  <span className="settings-range-head">
                    <span>题目留白</span>
                    <span className="settings-range-value">{bottomSpace}%</span>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={80}
                    step={1}
                    value={bottomSpace}
                    aria-label="题目留白"
                    onChange={(e) => onBottomSpaceChange(Number(e.target.value))}
                  />
                </label>
                <label className="settings-row settings-col" title="每页左下角的灰字署名;留空则不加">
                  <span>页脚署名(可选)</span>
                  <input
                    type="text"
                    maxLength={50}
                    placeholder="例:整理:张老师"
                    value={footerText}
                    onChange={(e) => onFooterTextChange(e.target.value)}
                  />
                </label>
                <label
                  className="settings-row"
                  title="署名文字的字号(pt),6-24;默认 8pt 小字"
                >
                  <span>署名字号(pt)</span>
                  <input
                    type="number"
                    min={6}
                    max={24}
                    step={1}
                    value={footerSize}
                    disabled={footerText.trim() === ""}
                    aria-label="署名字号"
                    onChange={(e) =>
                      onFooterSizeChange(Math.max(6, Math.min(24, Number(e.target.value) || 8)))
                    }
                  />
                </label>
              </div>
            )}
          </div>
          <button
            className="btn"
            onClick={() => onExport("pptx")}
            disabled={exportDisabled}
            title={includedCount === 0 ? "请先框选至少一道题" : "导出 16:9 PPTX(一题一页)"}
          >
            {exportBusy === "pptx" ? "导出中…" : "PPTX"}
          </button>
          <button
            className="btn primary"
            onClick={() => onExport("pdf")}
            disabled={exportDisabled}
            title={includedCount === 0 ? "请先框选至少一道题" : "导出横版 A4 PDF(一题一页)"}
          >
            {exportBusy === "pdf" ? "导出中…" : `导出 PDF (${includedCount})`}
          </button>
        </div>
      )}
    </header>
  );
}
