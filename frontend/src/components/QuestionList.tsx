import type { Question } from "../types";

interface Props {
  questions: Question[];
  activeQuestion: number | null;
  activeSegment: number | null;
  onSelectSegment: (qi: number, si: number) => void;
  onAddQuestion: () => void;
  onRemoveQuestion: (qi: number) => void;
  onRemoveSegment: (qi: number, si: number) => void;
  onRenumber: () => void;
}

export default function QuestionList({
  questions,
  activeQuestion,
  activeSegment,
  onSelectSegment,
  onAddQuestion,
  onRemoveQuestion,
  onRemoveSegment,
  onRenumber,
}: Props) {
  return (
    <div className="qlist">
      <div className="qlist-head">
        <strong>题目 ({questions.length})</strong>
        <div className="qlist-actions">
          <button className="mini" onClick={onAddQuestion}>+ 新增题目</button>
          <button className="mini ghost" onClick={onRenumber} title="按题号重排">
            重排题号
          </button>
        </div>
      </div>
      <div className="qlist-body">
        {questions.length === 0 && (
          <div className="qlist-empty">
            还没有题目。点击「新增题目」开始,然后在右侧 PDF 上双击设置结束行(Shift+双击 设置起始行)。
          </div>
        )}
        {questions.map((q, qi) => (
          <div className={"qcard" + (qi === activeQuestion ? " active" : "")} key={qi}>
            <div className="qcard-head">
              <span className="qno">第 {q.no} 题</span>
              <button className="mini danger" onClick={() => onRemoveQuestion(qi)}>
                删除
              </button>
            </div>
            <div className="qsegs">
              {q.segments.length === 0 && <div className="qseg-empty">无段,请在 PDF 上设置起止行</div>}
              {q.segments.map((s, si) => {
                const active = qi === activeQuestion && si === activeSegment;
                return (
                  <div
                    key={si}
                    className={"qseg" + (active ? " active" : "")}
                    onClick={() => onSelectSegment(qi, si)}
                  >
                    <span className="qseg-page">p{s.page + 1}</span>
                    <span className="qseg-range">
                      y {Math.min(s.y1, s.y2).toFixed(0)} → {Math.max(s.y1, s.y2).toFixed(0)} pt
                    </span>
                    <button
                      className="mini ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveSegment(qi, si);
                      }}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
