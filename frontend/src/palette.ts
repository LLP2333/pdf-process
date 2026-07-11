/**
 * 题目配色:按题目下标循环取色,画布区域与右侧面板共用,
 * 保证"画布上的框"和"面板里的卡片"视觉可对应。
 */
export const QUESTION_COLORS = [
  "#ef4444", // red
  "#f59e0b", // amber
  "#10b981", // emerald
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#14b8a6", // teal
  "#f97316", // orange
] as const;

/** 第 `index` 道题(0 起)的主题色。 */
export function questionColor(index: number): string {
  return QUESTION_COLORS[index % QUESTION_COLORS.length];
}
