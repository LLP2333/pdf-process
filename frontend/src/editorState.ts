import type { EditorQuestion, EditorRegion, Question } from "./types";

/**
 * 编辑器核心状态与操作(全部纯函数,不依赖 React)。
 *
 * 数据模型:`EditorQuestion[]` 的数组顺序 = 导出顺序(题号 = 下标 + 1)。
 * 一道题由 1..N 个 `EditorRegion` 组成,区域可指向任意已上传文档的任意页,
 * 导出时按区域列表顺序纵向堆叠 —— 这是"跨页 / 跨栏 / 跨文档组题"的统一表达。
 *
 * 撤销/重做:`History` 保存 questions 数组的不可变快照。
 * 数组与对象都按不可变方式更新,快照只是引用拷贝,内存开销可忽略;
 * 栈深上限 `HISTORY_LIMIT`,超出丢最旧的。
 */

export interface History {
  past: EditorQuestion[][];
  present: EditorQuestion[];
  future: EditorQuestion[][];
}

export const HISTORY_LIMIT = 50;

/** 新建空历史(初始状态或文档列表变化后重置时使用)。 */
export function emptyHistory(initial: EditorQuestion[] = []): History {
  return { past: [], present: initial, future: [] };
}

/**
 * 提交一次可撤销的状态变更:present 入栈,future 清空。
 *
 * Why 比较引用:操作函数在"无事发生"时(如删除不存在的区域)原样返回 present,
 * 此时不产生历史记录,避免撤销栈里出现一堆无效步骤。
 */
export function commit(history: History, next: EditorQuestion[]): History {
  if (next === history.present) return history;
  const past = [...history.past, history.present];
  if (past.length > HISTORY_LIMIT) past.shift();
  return { past, present: next, future: [] };
}

/**
 * 替换当前状态但不产生历史记录。
 *
 * 用于拖动/缩放过程中的实时反馈:高频中间态只改 present,
 * 手势结束时调用方再用「手势开始前的快照」`commitFrom` 一次性入栈。
 */
export function replacePresent(history: History, next: EditorQuestion[]): History {
  return { ...history, present: next };
}

/**
 * 以指定的"变更前快照"提交当前 present。
 *
 * 拖动手势:开始时记住 before,过程中若干次 `replacePresent`,
 * 结束时 `commitFrom(history, before)` —— 撤销一步即可回到拖动前。
 */
export function commitFrom(history: History, before: EditorQuestion[]): History {
  if (before === history.present) return history;
  const past = [...history.past, before];
  if (past.length > HISTORY_LIMIT) past.shift();
  return { past, present: history.present, future: [] };
}

export function undo(history: History): History {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1];
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redo(history: History): History {
  if (history.future.length === 0) return history;
  const [next, ...rest] = history.future;
  return {
    past: [...history.past, history.present],
    present: next,
    future: rest,
  };
}

export function canUndo(history: History): boolean {
  return history.past.length > 0;
}

export function canRedo(history: History): boolean {
  return history.future.length > 0;
}

// ---------------------------------------------------------------------------
// 题目 / 区域操作
// ---------------------------------------------------------------------------

/** 归一化矩形:保证 x1<x2、y1<y2(允许从任意对角画框)。 */
export function normalizeRect(region: EditorRegion): EditorRegion {
  return {
    ...region,
    x1: Math.min(region.x1, region.x2),
    x2: Math.max(region.x1, region.x2),
    y1: Math.min(region.y1, region.y2),
    y2: Math.max(region.y1, region.y2),
  };
}

/**
 * 区域的视觉排序键:文档序 → 页码 → 纵坐标 → 横坐标。
 *
 * `docOrder` 是文档 rail 里的 docId 顺序;未知文档排最后(理论上不出现,防御)。
 */
function regionOrderKey(
  region: EditorRegion,
  docOrder: string[],
): [number, number, number, number] {
  const docIndex = docOrder.indexOf(region.docId);
  return [docIndex === -1 ? Number.MAX_SAFE_INTEGER : docIndex, region.page, region.y1, region.x1];
}

function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * 把一道题按视觉顺序插入题目列表(以首区域为排序键)。
 *
 * Why 排序插入而不是尾插:用户通常从上往下框题,但也可能回头补漏,
 * 按 (文档序, 页, y) 插入能让题号始终符合试卷阅读顺序,免去大量手动重排。
 * 用户手动重排过的顺序不受影响 —— 只在新题插入时做一次定位。
 */
export function insertQuestionSorted(
  questions: EditorQuestion[],
  question: EditorQuestion,
  docOrder: string[],
): EditorQuestion[] {
  const first = question.regions[0];
  if (!first) return questions;
  const key = regionOrderKey(first, docOrder);
  let insertAt = questions.length;
  for (let i = 0; i < questions.length; i++) {
    const head = questions[i].regions[0];
    if (head && compareKeys(key, regionOrderKey(head, docOrder)) < 0) {
      insertAt = i;
      break;
    }
  }
  const next = [...questions];
  next.splice(insertAt, 0, question);
  return next;
}

/** 新建一道题(含首个区域),并按视觉顺序插入题目列表。 */
export function addQuestionWithRegion(
  questions: EditorQuestion[],
  region: EditorRegion,
  questionId: string,
  docOrder: string[],
): EditorQuestion[] {
  return insertQuestionSorted(
    questions,
    { id: questionId, regions: [normalizeRect(region)] },
    docOrder,
  );
}

/** 给指定题目追加一个区域(跨页/跨栏/跨文档题的画法);题目不存在时原样返回。 */
export function appendRegionToQuestion(
  questions: EditorQuestion[],
  questionId: string,
  region: EditorRegion,
): EditorQuestion[] {
  const index = questions.findIndex((q) => q.id === questionId);
  if (index === -1) return questions;
  const next = [...questions];
  next[index] = {
    ...next[index],
    regions: [...next[index].regions, normalizeRect(region)],
  };
  return next;
}

/** 更新某个区域的几何(移动/缩放后提交);找不到时原样返回。 */
export function updateRegionRect(
  questions: EditorQuestion[],
  regionId: string,
  rect: { x1: number; y1: number; x2: number; y2: number },
): EditorQuestion[] {
  let changed = false;
  const next = questions.map((q) => {
    const ri = q.regions.findIndex((r) => r.id === regionId);
    if (ri === -1) return q;
    changed = true;
    const regions = [...q.regions];
    regions[ri] = normalizeRect({ ...regions[ri], ...rect });
    return { ...q, regions };
  });
  return changed ? next : questions;
}

/** 删除一个区域;若这是题目的最后一个区域,则整题一并删除。 */
export function deleteRegion(
  questions: EditorQuestion[],
  regionId: string,
): EditorQuestion[] {
  let changed = false;
  const next: EditorQuestion[] = [];
  for (const q of questions) {
    if (!q.regions.some((r) => r.id === regionId)) {
      next.push(q);
      continue;
    }
    changed = true;
    const regions = q.regions.filter((r) => r.id !== regionId);
    if (regions.length > 0) next.push({ ...q, regions });
  }
  return changed ? next : questions;
}

/** 删除整道题;不存在时原样返回。 */
export function deleteQuestion(
  questions: EditorQuestion[],
  questionId: string,
): EditorQuestion[] {
  const next = questions.filter((q) => q.id !== questionId);
  return next.length === questions.length ? questions : next;
}

/** 把 fromIndex 的题移动到 toIndex(题目面板拖拽重排)。 */
export function moveQuestion(
  questions: EditorQuestion[],
  fromIndex: number,
  toIndex: number,
): EditorQuestion[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    fromIndex >= questions.length ||
    toIndex < 0 ||
    toIndex >= questions.length
  ) {
    return questions;
  }
  const next = [...questions];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

/** 切换某题"是否参与导出"。 */
export function toggleQuestionExcluded(
  questions: EditorQuestion[],
  questionId: string,
): EditorQuestion[] {
  const index = questions.findIndex((q) => q.id === questionId);
  if (index === -1) return questions;
  const next = [...questions];
  next[index] = { ...next[index], excluded: !next[index].excluded };
  return next;
}

/** 移除引用了某文档的所有区域(文档被删除时的级联清理);空题一并移除。 */
export function removeDocRegions(
  questions: EditorQuestion[],
  docId: string,
): EditorQuestion[] {
  let changed = false;
  const next: EditorQuestion[] = [];
  for (const q of questions) {
    const regions = q.regions.filter((r) => r.docId !== docId);
    if (regions.length === q.regions.length) {
      next.push(q);
      continue;
    }
    changed = true;
    if (regions.length > 0) next.push({ ...q, regions });
  }
  return changed ? next : questions;
}

/** 最小有效边长(pt):宽或高小于该值的框视为误触,不会被创建/导出。 */
export const MIN_REGION_SIZE_PT = 4;

/**
 * 把编辑器状态转成后端契约的 `Question[]`(导出/预览共用)。
 *
 * - 跳过 `excluded` 的题;
 * - 丢弃宽/高不足 `MIN_REGION_SIZE_PT` 或文档已不存在的区域;
 * - 题号按最终顺序重排为 1..N(后端按 `no` 排序,跳号会导致顺序错乱)。
 */
export function buildExportQuestions(
  questions: EditorQuestion[],
  validDocIds: string[],
): Question[] {
  const docSet = new Set(validDocIds);
  const out: Question[] = [];
  for (const q of questions) {
    if (q.excluded) continue;
    const regions = q.regions
      .map(normalizeRect)
      .filter(
        (r) =>
          docSet.has(r.docId) &&
          r.x2 - r.x1 >= MIN_REGION_SIZE_PT &&
          r.y2 - r.y1 >= MIN_REGION_SIZE_PT,
      )
      .map((r) => ({
        doc_id: r.docId,
        page: r.page,
        x1: r.x1,
        y1: r.y1,
        x2: r.x2,
        y2: r.y2,
      }));
    if (regions.length > 0) {
      out.push({ no: out.length + 1, regions });
    }
  }
  return out;
}

/**
 * 把单独一道题转成后端契约(题目面板实时预览用);
 * 无有效区域时返回 null,调用方直接显示空态、不发请求。
 */
export function buildPreviewQuestion(
  question: EditorQuestion,
  validDocIds: string[],
): Question | null {
  const built = buildExportQuestions([{ ...question, excluded: false }], validDocIds);
  return built.length > 0 ? built[0] : null;
}

/**
 * 把自动识别返回的分割线(N+1 条,已按 page/y 排序)转换成整页宽草稿题框。
 *
 * 相邻两条线之间为一题;跨页时按页拆成多个区域(与旧"分割线模式"的语义一致)。
 * 返回的 EditorQuestion 使用调用方提供的 id 生成器,便于测试注入确定性 id。
 */
export function draftQuestionsFromDividers(
  dividers: { page: number; y: number }[],
  docId: string,
  pages: { width: number; height: number }[],
  nextId: () => string,
): EditorQuestion[] {
  const sorted = [...dividers].sort((a, b) => (a.page === b.page ? a.y - b.y : a.page - b.page));
  const out: EditorQuestion[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const regions: EditorRegion[] = [];
    if (a.page === b.page) {
      if (b.y - a.y >= 1) {
        regions.push(regionOnPage(docId, a.page, a.y, b.y, pages, nextId));
      }
    } else {
      const headHeight = pages[a.page]?.height ?? 0;
      if (headHeight - a.y >= 1) {
        regions.push(regionOnPage(docId, a.page, a.y, headHeight, pages, nextId));
      }
      for (let p = a.page + 1; p < b.page; p++) {
        const ph = pages[p]?.height ?? 0;
        if (ph >= 1) regions.push(regionOnPage(docId, p, 0, ph, pages, nextId));
      }
      if (b.y >= 1) {
        regions.push(regionOnPage(docId, b.page, 0, b.y, pages, nextId));
      }
    }
    if (regions.length > 0) {
      out.push({ id: nextId(), regions });
    }
  }
  return out;
}

function regionOnPage(
  docId: string,
  page: number,
  y1: number,
  y2: number,
  pages: { width: number }[],
  nextId: () => string,
): EditorRegion {
  return {
    id: nextId(),
    docId,
    page,
    x1: 0,
    y1,
    x2: pages[page]?.width ?? 0,
    y2,
  };
}

/** 生成稳定 id(jsdom + 浏览器都可用)。 */
export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}
