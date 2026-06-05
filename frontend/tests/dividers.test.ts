import { describe, it, expect } from "vitest";
import {
  applyAdjustmentToQuestion,
  buildQuestionsFromDividers,
  newDividerId,
} from "../src/dividers";
import type { DerivedQuestion, Divider, PageInfo } from "../src/types";

function p(index: number, height = 842): PageInfo {
  return {
    index,
    width: 595,
    height,
    image_url: `/u/${index}`,
    image_width: 595,
    image_height: height,
  };
}

describe("buildQuestionsFromDividers", () => {
  it("没有分割线时返回空(不再把整个文档视为一题)", () => {
    expect(buildQuestionsFromDividers([], [p(0), p(1)])).toEqual([]);
  });

  it("只有 1 条分割线时返回空", () => {
    const dividers: Divider[] = [{ id: "a", page: 0, y: 400 }];
    expect(buildQuestionsFromDividers(dividers, [p(0), p(1)])).toEqual([]);
  });

  it("同页两条分割线得到一道题(线以外的内容被忽略)", () => {
    const dividers: Divider[] = [
      { id: "a", page: 0, y: 120 },
      { id: "b", page: 0, y: 400 },
    ];
    const qs = buildQuestionsFromDividers(dividers, [p(0), p(1)]);
    expect(qs).toHaveLength(1);
    expect(qs[0].no).toBe(1);
    expect(qs[0].segments).toEqual([{ page: 0, y1: 120, y2: 400 }]);
    expect(qs[0].id).toBe("a|b");
  });

  it("三条分割线得到两道题,中间页面被全部包入", () => {
    const dividers: Divider[] = [
      { id: "a", page: 0, y: 300 },
      { id: "b", page: 1, y: 500 },
      { id: "c", page: 2, y: 200 },
    ];
    const qs = buildQuestionsFromDividers(dividers, [p(0), p(1), p(2)]);
    expect(qs).toHaveLength(2);
    expect(qs[0].segments).toEqual([
      { page: 0, y1: 300, y2: 842 },
      { page: 1, y1: 0, y2: 500 },
    ]);
    expect(qs[1].segments).toEqual([
      { page: 1, y1: 500, y2: 842 },
      { page: 2, y1: 0, y2: 200 },
    ]);
  });

  it("乱序输入按 (page, y) 排序后正确切分", () => {
    const dividers: Divider[] = [
      { id: "c", page: 1, y: 500 },
      { id: "a", page: 0, y: 120 },
      { id: "b", page: 0, y: 400 },
    ];
    const qs = buildQuestionsFromDividers(dividers, [p(0), p(1)]);
    expect(qs).toHaveLength(2);
    expect(qs[0].id).toBe("a|b");
    expect(qs[1].id).toBe("b|c");
  });

  it("无页面时返回空", () => {
    expect(
      buildQuestionsFromDividers(
        [
          { id: "a", page: 0, y: 10 },
          { id: "b", page: 0, y: 20 },
        ],
        [],
      ),
    ).toEqual([]);
  });
});

describe("applyAdjustmentToQuestion", () => {
  const baseQ: DerivedQuestion = {
    id: "a|b",
    no: 1,
    segments: [
      { page: 0, y1: 100, y2: 400 },
      { page: 1, y1: 0, y2: 300 },
    ],
  };

  it("无调整时原样返回 segments", () => {
    const res = applyAdjustmentToQuestion(baseQ, undefined);
    expect(res.segments).toEqual(baseQ.segments);
  });

  it("顶部裁剪只改第一段的 y1", () => {
    const res = applyAdjustmentToQuestion(baseQ, { top: 30, bottom: 0 });
    expect(res.segments).toEqual([
      { page: 0, y1: 130, y2: 400 },
      { page: 1, y1: 0, y2: 300 },
    ]);
  });

  it("底部裁剪只改最后一段的 y2", () => {
    const res = applyAdjustmentToQuestion(baseQ, { top: 0, bottom: 50 });
    expect(res.segments).toEqual([
      { page: 0, y1: 100, y2: 400 },
      { page: 1, y1: 0, y2: 250 },
    ]);
  });

  it("过度裁剪时丢弃越界段(但仍能保留可用段)", () => {
    const q: DerivedQuestion = {
      id: "x",
      no: 1,
      segments: [
        { page: 0, y1: 100, y2: 150 },
        { page: 1, y1: 0, y2: 200 },
      ],
    };
    const res = applyAdjustmentToQuestion(q, { top: 80, bottom: 0 });
    // 第一段被裁没;第二段保留
    expect(res.segments).toEqual([{ page: 1, y1: 0, y2: 200 }]);
  });
});

describe("newDividerId", () => {
  it("返回非空字符串且每次都不同", () => {
    const a = newDividerId();
    const b = newDividerId();
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toEqual(b);
  });
});
