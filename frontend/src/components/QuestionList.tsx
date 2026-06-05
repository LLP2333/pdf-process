import type { Question } from "../types";

interface Props {
  questions: Question[];
  activeQuestionIndex: number | null;
  onSelectQuestion: (qi: number) => void;
  onClearDividers: () => void;
  dividerCount: number;
}

/**
 * 派生题目列表(只读视图):由分割线推导出的题目逐项展示。
 *
 * 用户不再直接增删题目 —— 一切都来自「在 PDF 上加分割线」,
 * 因此本面板只负责展示与跳转,顶部提供「清空分割线」一键回到初始态。
 */
export default function QuestionList({
  questions,
  activeQuestionIndex,
  onSelectQuestion,
  onClearDividers,
  dividerCount,
}: Props) {
  return (
    <div className="qlist">
      <div className="qlist-head">
        <strong>题目 ({questions.length})</strong>
        <div className="qlist-actions">
          <button
            className="mini ghost"
            onClick={onClearDividers}
            disabled={dividerCount === 0}
            title="移除所有分割线,文档恢复为一道题"
          >
            清空分割线
          </button>
        </div>
      </div>
      <div className="qlist-body">
        {dividerCount === 0 && (
          <div className="qlist-empty">
            还没有分割线。在右侧 PDF 上<b>单击</b>即可加一条分割线;
            相邻两条分割线之间的内容会被识别为一道题。
          </div>
        )}
        {questions.map((q, qi) => {
          const totalRanges = q.segments
            .map((s) => {
              const a = Math.min(s.y1, s.y2);
              const b = Math.max(s.y1, s.y2);
              return `p${s.page + 1} ${a.toFixed(0)}→${b.toFixed(0)}pt`;
            })
            .join(" · ");
          return (
            <div
              key={qi}
              className={"qcard" + (qi === activeQuestionIndex ? " active" : "")}
              onClick={() => onSelectQuestion(qi)}
            >
              <div className="qcard-head">
                <span className="qno">第 {q.no} 题</span>
                <span className="qcard-meta">{q.segments.length} 段</span>
              </div>
              <div className="qcard-range">{totalRanges}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
