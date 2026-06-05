import type {
  Adjustment,
  DerivedQuestion,
  Divider,
  PageInfo,
  Question,
} from "./types";

/**
 * 把"两条相邻分割线之间"识别为一道题。
 *
 * 设计要点:
 * - **不再使用文档首末作为隐式边界**:第一条分割线以上、最后一条分割线以下的内容
 *   不会被纳入任何题目(这样用户可以用第一条线"裁掉页眉",最后一条线"裁掉页脚")。
 * - N 条分割线 ⇒ 至多 N-1 道题;少于 2 条分割线时返回空数组。
 * - 跨页时拆成多段 `Segment`,与后端契约保持一致。
 * - 每道题附带稳定 `id = ${aDividerId}|${bDividerId}`(排序后),
 *   方便外层挂载二次裁剪等本地状态。
 */
export function buildQuestionsFromDividers(
  dividers: Divider[],
  pages: PageInfo[],
): DerivedQuestion[] {
  if (pages.length === 0 || dividers.length < 2) return [];

  const sorted = [...dividers].sort((a, b) =>
    a.page === b.page ? a.y - b.y : a.page - b.page,
  );

  const out: DerivedQuestion[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const segments = segmentsBetween(a, b, pages);
    if (segments.length > 0) {
      out.push({ id: `${a.id}|${b.id}`, no: out.length + 1, segments });
    }
  }
  return out;
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
 * 把单题的"顶部/底部再裁"应用到 segments,得到上传给后端的纯净 `Question`。
 *
 * 顶部裁剪作用在第一段的 y1(向下推);底部裁剪作用在最后一段的 y2(向上拉)。
 * 若裁过头(段内 y1 ≥ y2)整段会被丢弃;若所有段都被裁没,返回 `segments=[]`,
 * 调用方应当过滤掉这种题。
 */
export function applyAdjustmentToQuestion(
  q: DerivedQuestion,
  adj: Adjustment | undefined,
): Question {
  const cleaned: Question["segments"] = q.segments.map((s) => ({
    page: s.page,
    y1: Math.min(s.y1, s.y2),
    y2: Math.max(s.y1, s.y2),
  }));
  if (!adj || (!adj.top && !adj.bottom)) {
    return { no: q.no, segments: cleaned };
  }
  if (adj.top > 0 && cleaned.length > 0) {
    cleaned[0] = { ...cleaned[0], y1: cleaned[0].y1 + adj.top };
  }
  if (adj.bottom > 0 && cleaned.length > 0) {
    const last = cleaned[cleaned.length - 1];
    cleaned[cleaned.length - 1] = { ...last, y2: last.y2 - adj.bottom };
  }
  const valid = cleaned.filter((s) => s.y2 - s.y1 >= 1);
  return { no: q.no, segments: valid };
}

/** 生成稳定 id(jsdom + 浏览器都可用)。 */
export function newDividerId(): string {
  return `d-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}
