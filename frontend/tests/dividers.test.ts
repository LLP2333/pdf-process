import { describe, it, expect } from "vitest";
import { buildQuestionsFromDividers, newDividerId } from "../src/dividers";
import type { Divider, PageInfo } from "../src/types";

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
  it("没有分割线时整文档视为一道题", () => {
    const pages = [p(0), p(1)];
    const qs = buildQuestionsFromDividers([], pages);
    expect(qs).toHaveLength(1);
    expect(qs[0]).toEqual({
      no: 1,
      segments: [
        { page: 0, y1: 0, y2: 842 },
        { page: 1, y1: 0, y2: 842 },
      ],
    });
  });

  it("同页一条分割线把页面切成两题", () => {
    const dividers: Divider[] = [{ id: "a", page: 0, y: 400 }];
    const pages = [p(0), p(1)];
    const qs = buildQuestionsFromDividers(dividers, pages);
    expect(qs).toHaveLength(2);
    expect(qs[0]).toEqual({ no: 1, segments: [{ page: 0, y1: 0, y2: 400 }] });
    expect(qs[1].segments).toEqual([
      { page: 0, y1: 400, y2: 842 },
      { page: 1, y1: 0, y2: 842 },
    ]);
  });

  it("跨页分割线得到正确的多段题", () => {
    // 在 p0 y=300 和 p1 y=500 各加一条分割线 → 共三道题
    const dividers: Divider[] = [
      { id: "a", page: 0, y: 300 },
      { id: "b", page: 1, y: 500 },
    ];
    const pages = [p(0), p(1), p(2)];
    const qs = buildQuestionsFromDividers(dividers, pages);
    expect(qs).toHaveLength(3);
    expect(qs[0].segments).toEqual([{ page: 0, y1: 0, y2: 300 }]);
    expect(qs[1].segments).toEqual([
      { page: 0, y1: 300, y2: 842 },
      { page: 1, y1: 0, y2: 500 },
    ]);
    expect(qs[2].segments).toEqual([
      { page: 1, y1: 500, y2: 842 },
      { page: 2, y1: 0, y2: 842 },
    ]);
  });

  it("乱序输入按 (page, y) 排序后正确切分", () => {
    const dividers: Divider[] = [
      { id: "b", page: 1, y: 200 },
      { id: "a", page: 0, y: 400 },
    ];
    const pages = [p(0), p(1)];
    const qs = buildQuestionsFromDividers(dividers, pages);
    expect(qs).toHaveLength(3);
    expect(qs[0].segments).toEqual([{ page: 0, y1: 0, y2: 400 }]);
    expect(qs[1].segments).toEqual([
      { page: 0, y1: 400, y2: 842 },
      { page: 1, y1: 0, y2: 200 },
    ]);
    expect(qs[2].segments).toEqual([{ page: 1, y1: 200, y2: 842 }]);
  });

  it("题号从 1 开始且自然递增,即使中间有空区间也会被跳过", () => {
    // 把分割线画在最顶部 y=0 应当导致第一题被丢弃
    const dividers: Divider[] = [{ id: "x", page: 0, y: 0.4 }];
    const pages = [p(0)];
    const qs = buildQuestionsFromDividers(dividers, pages);
    expect(qs).toHaveLength(1);
    expect(qs[0].no).toBe(1);
  });

  it("无页面时返回空", () => {
    expect(buildQuestionsFromDividers([{ id: "x", page: 0, y: 10 }], [])).toEqual([]);
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
