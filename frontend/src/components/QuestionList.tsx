import type { Adjustment, DerivedQuestion } from "../types";

interface Props {
  questions: DerivedQuestion[];
  activeQuestionIndex: number | null;
  onSelectQuestion: (qi: number) => void;
  onClearDividers: () => void;
  dividerCount: number;
  adjustments: Record<string, Adjustment>;
}

/**
 * 派生题目列表(只读视图):由"两条相邻分割线之间的内容"派生出题目。
 *
 * 不再直接增删题目 —— 一切都来自分割线。
 * 卡片标签:跨页时显示"跨 N 页",单页时显示页码;若该题有二次裁剪,加角标提示。
 */
export default function QuestionList({
  questions,
  activeQuestionIndex,
  onSelectQuestion,
  onClearDividers,
  dividerCount,
  adjustments,
}: Props) {
  const tooFewDividers = dividerCount < 2;
  return (
    <div className="qlist">
      <div className="qlist-head">
        <strong>题目 ({questions.length})</strong>
        <div className="qlist-actions">
          <button
            className="mini ghost"
            onClick={onClearDividers}
            disabled={dividerCount === 0}
            title="移除所有分割线"
          >
            清空分割线
          </button>
        </div>
      </div>
      <div className="qlist-body">
        {tooFewDividers && (
          <div className="qlist-empty">
            {dividerCount === 0
              ? "还没有分割线。在右侧 PDF 上单击,在每道题的开头与结尾各画一条;"
              : "已有 1 条分割线。再加 1 条,两条之间的内容就会被识别为一道题。"}
            <br />
            <span className="hint">
              第一条分割线<b>以上</b>、最后一条分割线<b>以下</b>的内容会被自动忽略
              (适合排除页眉 / 页脚 / 页码)。
            </span>
          </div>
        )}
        {questions.map((q, qi) => {
          const pages = Array.from(new Set(q.segments.map((s) => s.page + 1))).sort((a, b) => a - b);
          const pageDesc =
            pages.length === 1 ? `第 ${pages[0]} 页` : `跨 ${pages.length} 页(p${pages.join(",p")})`;
          const adj = adjustments[q.id];
          const trimmed = adj && (adj.top > 0 || adj.bottom > 0);
          return (
            <div
              key={q.id}
              className={"qcard" + (qi === activeQuestionIndex ? " active" : "")}
              onClick={() => onSelectQuestion(qi)}
            >
              <div className="qcard-head">
                <span className="qno">第 {q.no} 题</span>
                <span className="qcard-meta">
                  {pageDesc}
                  {trimmed && <span className="qcard-trim" title="已二次裁剪">✎</span>}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
