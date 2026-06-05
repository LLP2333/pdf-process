import type { Divider, PageInfo, Question } from "./types";

/**
 * 把 PDF 全文档当作一根纵向"长卷",分割线之间的内容为一道题。
 *
 * 输入:用户在每页画的水平分割线集合(乱序也无所谓)+ 各页元信息。
 * 输出:按题号 1..N 升序排列的 `Question` 数组,跨页时拆成多段 `Segment`。
 *
 * Why 在前端做这一层推导:
 * - 后端 API 还是按 `Question[]` + `Segment[]` 接收,不改既有契约;
 * - 单击/拖动分割线是高频操作,放前端推导无需往返。
 */
export function buildQuestionsFromDividers(
  dividers: Divider[],
  pages: PageInfo[],
): Question[] {
  if (pages.length === 0) return [];

  const sorted = [...dividers].sort((a, b) =>
    a.page === b.page ? a.y - b.y : a.page - b.page,
  );
  const lastPage = pages.length - 1;
  const boundaries: { page: number; y: number }[] = [
    { page: 0, y: 0 },
    ...sorted.map((d) => ({ page: d.page, y: d.y })),
    { page: lastPage, y: pages[lastPage].height },
  ];

  const questions: Question[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const a = boundaries[i];
    const b = boundaries[i + 1];
    const segments = segmentsBetween(a, b, pages);
    if (segments.length > 0) {
      questions.push({ no: questions.length + 1, segments });
    }
  }
  return questions;
}

function segmentsBetween(
  a: { page: number; y: number },
  b: { page: number; y: number },
  pages: PageInfo[],
): Question["segments"] {
  if (a.page === b.page) {
    if (b.y - a.y < 1) return [];
    return [{ page: a.page, y1: a.y, y2: b.y }];
  }
  const segs: Question["segments"] = [];
  const headHeight = pages[a.page]?.height ?? 0;
  if (headHeight - a.y >= 1) segs.push({ page: a.page, y1: a.y, y2: headHeight });
  for (let p = a.page + 1; p < b.page; p++) {
    const ph = pages[p]?.height ?? 0;
    if (ph >= 1) segs.push({ page: p, y1: 0, y2: ph });
  }
  if (b.y >= 1) segs.push({ page: b.page, y1: 0, y2: b.y });
  return segs;
}

/**
 * 给定一个 divider 索引,返回 (推导出的) 与其紧邻的两个题号:
 * 该分割线的上方是第 N 题、下方是第 N+1 题。`null` 表示没有上/下题(罕见空白边界)。
 */
export function neighborQuestionsOfDivider(
  divider: Divider,
  dividers: Divider[],
  pages: PageInfo[],
): { above: number | null; below: number | null } {
  const questions = buildQuestionsFromDividers(dividers, pages);
  const sorted = [...dividers].sort((a, b) =>
    a.page === b.page ? a.y - b.y : a.page - b.page,
  );
  const idx = sorted.findIndex((d) => d.id === divider.id);
  if (idx === -1) return { above: null, below: null };
  return {
    above: questions[idx]?.no ?? null,
    below: questions[idx + 1]?.no ?? null,
  };
}

/** 生成稳定 id(jsdom + 浏览器都可用)。 */
export function newDividerId(): string {
  return `d-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}
