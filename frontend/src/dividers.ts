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
 * 把派生题目转成"可以上传给后端"的纯净 `Question`,并把"二次裁剪"放在 `trim` 字段上。
 *
 * **关键约定**:trim 不再直接改 segments 的 y1/y2,而是作为 question 上的字段
 * 单独传给后端,由后端在 `auto_trim` **之后**再向内吃掉 top/bottom。
 * 这样可避免"用户调的 top 量 < 自动去白边量"时被 `max(clip.y0, ty0)` 吞掉,
 * 让微调始终可见(尤其是跨页题的顶部)。
 *
 * 过度裁剪(top/bottom 大到把第一/最后一段裁没)的丢弃逻辑由后端 `_normalize_segments`
 * 统一处理。
 */
export function applyAdjustmentToQuestion(
  q: DerivedQuestion,
  adj: Adjustment | undefined,
): Question {
  const segments: Question["segments"] = q.segments.map((s) => ({
    page: s.page,
    y1: Math.min(s.y1, s.y2),
    y2: Math.max(s.y1, s.y2),
  }));
  if (!adj || (adj.top <= 0 && adj.bottom <= 0)) {
    return { no: q.no, segments };
  }
  return {
    no: q.no,
    segments,
    trim: { top: Math.max(0, adj.top), bottom: Math.max(0, adj.bottom) },
  };
}

/** 生成稳定 id(jsdom + 浏览器都可用)。 */
export function newDividerId(): string {
  return `d-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}
