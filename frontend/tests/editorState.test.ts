import { describe, it, expect } from "vitest";
import {
  addQuestionWithRegion,
  appendRegionToQuestion,
  buildExportQuestions,
  buildPreviewQuestion,
  canRedo,
  canUndo,
  commit,
  commitFrom,
  deleteQuestion,
  deleteRegion,
  draftQuestionsFromDividers,
  emptyHistory,
  HISTORY_LIMIT,
  moveQuestion,
  normalizeRect,
  redo,
  removeDocRegions,
  replacePresent,
  toggleQuestionExcluded,
  undo,
  updateRegionRect,
} from "../src/editorState";
import type { EditorQuestion, EditorRegion } from "../src/types";

const DOC_A = "aaaaaaaaaaaaaaaa";
const DOC_B = "bbbbbbbbbbbbbbbb";

let seq = 0;
function region(overrides: Partial<EditorRegion> = {}): EditorRegion {
  seq += 1;
  return {
    id: `r${seq}`,
    docId: DOC_A,
    page: 0,
    x1: 10,
    y1: 10,
    x2: 100,
    y2: 60,
    ...overrides,
  };
}

describe("normalizeRect", () => {
  it("任意对角线画框都归一为 x1<x2 / y1<y2", () => {
    const r = normalizeRect(region({ x1: 100, y1: 80, x2: 20, y2: 30 }));
    expect(r.x1).toBe(20);
    expect(r.x2).toBe(100);
    expect(r.y1).toBe(30);
    expect(r.y2).toBe(80);
  });
});

describe("addQuestionWithRegion 排序插入", () => {
  it("按 文档序 → 页 → y 插入,后画的上方题目应排在前面", () => {
    let qs: EditorQuestion[] = [];
    qs = addQuestionWithRegion(qs, region({ page: 1, y1: 100, y2: 200 }), "q1", [DOC_A]);
    qs = addQuestionWithRegion(qs, region({ page: 0, y1: 500, y2: 600 }), "q2", [DOC_A]);
    // 回头补漏:第 0 页顶部的题
    qs = addQuestionWithRegion(qs, region({ page: 0, y1: 50, y2: 90 }), "q3", [DOC_A]);
    expect(qs.map((q) => q.id)).toEqual(["q3", "q2", "q1"]);
  });

  it("不同文档按 rail 顺序排:B 卷的题排在 A 卷之后", () => {
    let qs: EditorQuestion[] = [];
    qs = addQuestionWithRegion(qs, region({ docId: DOC_B, page: 0, y1: 10, y2: 50 }), "qb", [DOC_A, DOC_B]);
    qs = addQuestionWithRegion(qs, region({ docId: DOC_A, page: 1, y1: 10, y2: 50 }), "qa", [DOC_A, DOC_B]);
    expect(qs.map((q) => q.id)).toEqual(["qa", "qb"]);
  });
});

describe("区域增删改", () => {
  it("appendRegionToQuestion 给已有题目追加区域;未知题目原样返回", () => {
    let qs = addQuestionWithRegion([], region(), "q1", [DOC_A]);
    qs = appendRegionToQuestion(qs, "q1", region({ page: 1 }));
    expect(qs[0].regions).toHaveLength(2);
    expect(appendRegionToQuestion(qs, "missing", region())).toBe(qs);
  });

  it("updateRegionRect 更新几何并保持归一;未知区域原样返回", () => {
    const r = region({ id: "target" });
    const qs = addQuestionWithRegion([], r, "q1", [DOC_A]);
    const next = updateRegionRect(qs, "target", { x1: 90, y1: 70, x2: 30, y2: 20 });
    expect(next[0].regions[0]).toMatchObject({ x1: 30, x2: 90, y1: 20, y2: 70 });
    expect(updateRegionRect(qs, "missing", { x1: 0, y1: 0, x2: 1, y2: 1 })).toBe(qs);
  });

  it("deleteRegion 删除最后一个区域时整题消失;多区域时只删区域", () => {
    let qs = addQuestionWithRegion([], region({ id: "r-a" }), "q1", [DOC_A]);
    qs = appendRegionToQuestion(qs, "q1", region({ id: "r-b" }));
    const afterOne = deleteRegion(qs, "r-a");
    expect(afterOne).toHaveLength(1);
    expect(afterOne[0].regions.map((r) => r.id)).toEqual(["r-b"]);
    const afterBoth = deleteRegion(afterOne, "r-b");
    expect(afterBoth).toHaveLength(0);
  });

  it("deleteQuestion 删除整题;未知 id 原样返回", () => {
    const qs = addQuestionWithRegion([], region(), "q1", [DOC_A]);
    expect(deleteQuestion(qs, "q1")).toHaveLength(0);
    expect(deleteQuestion(qs, "nope")).toBe(qs);
  });

  it("removeDocRegions 级联清理某文档的区域,空题一并移除", () => {
    let qs = addQuestionWithRegion([], region({ docId: DOC_A }), "qa", [DOC_A, DOC_B]);
    qs = addQuestionWithRegion(qs, region({ docId: DOC_B, page: 0 }), "qb", [DOC_A, DOC_B]);
    qs = appendRegionToQuestion(qs, "qa", region({ docId: DOC_B, page: 1 }));
    const next = removeDocRegions(qs, DOC_B);
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe("qa");
    expect(next[0].regions).toHaveLength(1);
    expect(next[0].regions[0].docId).toBe(DOC_A);
  });
});

describe("moveQuestion / toggleQuestionExcluded", () => {
  it("moveQuestion 重排题目;非法下标原样返回", () => {
    let qs = addQuestionWithRegion([], region({ y1: 10, y2: 20 }), "q1", [DOC_A]);
    qs = addQuestionWithRegion(qs, region({ y1: 30, y2: 40 }), "q2", [DOC_A]);
    qs = addQuestionWithRegion(qs, region({ y1: 50, y2: 60 }), "q3", [DOC_A]);
    const moved = moveQuestion(qs, 2, 0);
    expect(moved.map((q) => q.id)).toEqual(["q3", "q1", "q2"]);
    expect(moveQuestion(qs, 5, 0)).toBe(qs);
    expect(moveQuestion(qs, 1, 1)).toBe(qs);
  });

  it("toggleQuestionExcluded 往返切换", () => {
    const qs = addQuestionWithRegion([], region(), "q1", [DOC_A]);
    const off = toggleQuestionExcluded(qs, "q1");
    expect(off[0].excluded).toBe(true);
    const on = toggleQuestionExcluded(off, "q1");
    expect(on[0].excluded).toBe(false);
  });
});

describe("buildExportQuestions", () => {
  it("跳过 excluded 与无效区域,题号连续重排", () => {
    let qs = addQuestionWithRegion([], region({ y1: 10, y2: 20 }), "q1", [DOC_A]);
    qs = addQuestionWithRegion(qs, region({ y1: 30, y2: 40 }), "q2", [DOC_A]);
    qs = addQuestionWithRegion(qs, region({ y1: 50, y2: 52 }), "q3", [DOC_A]); // 高 2pt < 最小值
    qs = toggleQuestionExcluded(qs, "q1");
    const out = buildExportQuestions(qs, [DOC_A]);
    expect(out).toHaveLength(1);
    expect(out[0].no).toBe(1);
    expect(out[0].regions[0]).toMatchObject({ doc_id: DOC_A, page: 0 });
  });

  it("文档已被移除时其区域不参与导出", () => {
    const qs = addQuestionWithRegion([], region({ docId: DOC_B }), "q1", [DOC_A, DOC_B]);
    expect(buildExportQuestions(qs, [DOC_A])).toHaveLength(0);
  });

  it("buildPreviewQuestion 对无有效区域的题返回 null", () => {
    const qs = addQuestionWithRegion([], region({ docId: DOC_B }), "q1", [DOC_B]);
    expect(buildPreviewQuestion(qs[0], [])).toBeNull();
    expect(buildPreviewQuestion(qs[0], [DOC_B])).not.toBeNull();
  });
});

describe("撤销 / 重做", () => {
  it("commit → undo → redo 的完整往返", () => {
    let h = emptyHistory();
    const s1 = addQuestionWithRegion(h.present, region(), "q1", [DOC_A]);
    h = commit(h, s1);
    const s2 = addQuestionWithRegion(h.present, region({ y1: 200, y2: 300 }), "q2", [DOC_A]);
    h = commit(h, s2);
    expect(h.present).toHaveLength(2);
    expect(canUndo(h)).toBe(true);

    h = undo(h);
    expect(h.present).toHaveLength(1);
    expect(canRedo(h)).toBe(true);

    h = undo(h);
    expect(h.present).toHaveLength(0);
    expect(canUndo(h)).toBe(false);
    h = undo(h); // 空栈继续 undo 是 no-op
    expect(h.present).toHaveLength(0);

    h = redo(h);
    h = redo(h);
    expect(h.present).toHaveLength(2);
    expect(canRedo(h)).toBe(false);
  });

  it("commit 相同引用是 no-op;新 commit 清空 future", () => {
    let h = emptyHistory();
    const s1 = addQuestionWithRegion(h.present, region(), "q1", [DOC_A]);
    h = commit(h, s1);
    expect(commit(h, h.present)).toBe(h);

    h = undo(h);
    const s2 = addQuestionWithRegion(h.present, region({ y1: 400, y2: 500 }), "qx", [DOC_A]);
    h = commit(h, s2);
    expect(canRedo(h)).toBe(false);
  });

  it("replacePresent 不产生历史;commitFrom 用手势前快照入栈", () => {
    let h = emptyHistory();
    const before = addQuestionWithRegion(h.present, region({ id: "drag" }), "q1", [DOC_A]);
    h = commit(h, before);
    // 模拟拖动:两次中间态,只在结束时入栈一次
    h = replacePresent(h, updateRegionRect(h.present, "drag", { x1: 20, y1: 20, x2: 110, y2: 70 }));
    h = replacePresent(h, updateRegionRect(h.present, "drag", { x1: 30, y1: 30, x2: 120, y2: 80 }));
    expect(h.past).toHaveLength(1);
    h = commitFrom(h, before);
    expect(h.past).toHaveLength(2);
    h = undo(h);
    expect(h.present).toBe(before);
  });

  it("历史栈超过上限时丢弃最旧快照", () => {
    let h = emptyHistory();
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) {
      h = commit(h, addQuestionWithRegion(h.present, region({ y1: i * 10, y2: i * 10 + 5 }), `q${i}`, [DOC_A]));
    }
    expect(h.past.length).toBe(HISTORY_LIMIT);
  });
});

describe("draftQuestionsFromDividers(自动识别 → 草稿题框)", () => {
  const pages = [
    { width: 595, height: 842 },
    { width: 595, height: 842 },
  ];
  let counter = 0;
  const nextId = () => `id${++counter}`;

  it("N+1 条分割线转成 N 道整页宽草稿题", () => {
    const drafts = draftQuestionsFromDividers(
      [
        { page: 0, y: 100 },
        { page: 0, y: 300 },
        { page: 0, y: 500 },
      ],
      DOC_A,
      pages,
      nextId,
    );
    expect(drafts).toHaveLength(2);
    expect(drafts[0].regions[0]).toMatchObject({ x1: 0, x2: 595, y1: 100, y2: 300 });
  });

  it("跨页对折成多区域;不足 1pt 的段被丢弃", () => {
    const drafts = draftQuestionsFromDividers(
      [
        { page: 0, y: 700 },
        { page: 1, y: 200 },
      ],
      DOC_A,
      pages,
      nextId,
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0].regions).toHaveLength(2);
    expect(drafts[0].regions[0]).toMatchObject({ page: 0, y1: 700, y2: 842 });
    expect(drafts[0].regions[1]).toMatchObject({ page: 1, y1: 0, y2: 200 });

    const empty = draftQuestionsFromDividers(
      [
        { page: 0, y: 100 },
        { page: 0, y: 100.5 },
      ],
      DOC_A,
      pages,
      nextId,
    );
    expect(empty).toHaveLength(0);
  });
});
