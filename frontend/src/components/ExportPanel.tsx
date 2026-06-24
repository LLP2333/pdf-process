interface AutoDetectMessage {
  text: string;
  /** 提示色调:info=绿(识别成功)/ warn=黄(无题号)/ error=红(扫描件 / 网络异常)。 */
  tone: "info" | "warn" | "error";
}

interface Props {
  questionCount: number;
  autoTrim: boolean;
  onAutoTrimChange: (value: boolean) => void;
  margin: number;
  onMarginChange: (value: number) => void;
  /** 打开「预览 + 二次裁剪」弹窗;真正的导出在弹窗里完成。 */
  onOpenPreview: () => void;
  /** 折叠左侧栏:平板等窄屏下把参数面板收起,给 PDF 预览区让出空间。 */
  onCollapse: () => void;
  /** 调后端 `/api/auto_detect` 自动识别题号 → 替换分割线。 */
  onAutoDetect: () => void;
  /** 自动识别请求进行中(禁用按钮 + 文字提示)。 */
  autoDetecting: boolean;
  /** 上一次自动识别的结果文案(扫描件 / 已识别 N 题 / 失败原因)。 */
  autoDetectMessage: AutoDetectMessage | null;
}

/**
 * 导出准备面板:被挂在左栏顶部。
 *
 * 承担三件事:
 * 1. 设置导出参数(自动去白边、页边距);
 * 2. 「自动识别」按钮:对文字版 PDF 一键识别题号,扫描件会通过提示文案告知用户;
 * 3. 「预览裁剪效果」按钮:打开弹窗逐题二次裁剪,并在弹窗里完成最终导出。
 *
 * Why 自动识别按钮放这里:与"导出参数"同属"全局动作",且要先决定"是否需要手动画分割线",
 * 自然走在用户的视觉路径首位。真正的导出按钮放在 PreviewModal 内,因为用户应当先看到
 * 裁剪效果(尤其是页眉/页脚是否被误带),再决定要不要落盘。
 */
export default function ExportPanel({
  questionCount,
  autoTrim,
  onAutoTrimChange,
  margin,
  onMarginChange,
  onOpenPreview,
  onCollapse,
  onAutoDetect,
  autoDetecting,
  autoDetectMessage,
}: Props) {
  const disabled = questionCount === 0;
  return (
    <div className="export">
      <div className="export-head">
        <span>导出参数</span>
        <button
          className="side-collapse-btn"
          onClick={onCollapse}
          title="折叠面板"
          aria-label="折叠导出参数与题目面板"
        >
          ‹
        </button>
      </div>
      <button
        className="btn ghost auto-detect-btn"
        onClick={onAutoDetect}
        disabled={autoDetecting}
        title="判断 PDF 是否文字版,文字版会按行首题号自动添加分割线"
      >
        {autoDetecting ? "识别中…" : "✨ 自动识别题号"}
      </button>
      {autoDetectMessage && (
        <div className={`auto-detect-msg auto-detect-${autoDetectMessage.tone}`}>
          {autoDetectMessage.text}
        </div>
      )}
      <label className="export-row">
        <input
          type="checkbox"
          checked={autoTrim}
          onChange={(e) => onAutoTrimChange(e.target.checked)}
        />
        <span>自动去除题目上下白边</span>
      </label>
      <label
        className="export-row"
        title="导出 PDF / PPTX 时,题区与纸面四边之间留出的空白(pt)。1 pt ≈ 0.353 mm"
      >
        <span>页边距(pt)</span>
        <input
          type="number"
          min={0}
          max={120}
          step={2}
          value={margin}
          onChange={(e) => onMarginChange(Math.max(0, Math.min(120, Number(e.target.value) || 0)))}
        />
      </label>
      <button
        className="btn primary export-preview-btn"
        onClick={onOpenPreview}
        disabled={disabled}
        title={disabled ? "请先在 PDF 上添加至少两条分割线" : "查看裁剪效果并二次微调"}
      >
        {disabled ? "请先添加分割线" : `预览裁剪效果 (${questionCount} 题)`}
      </button>
      <div className="export-hint">
        点开预览可<b>逐题微调上下边界</b>,确认无误后在弹窗内一键导出。
      </div>
    </div>
  );
}
