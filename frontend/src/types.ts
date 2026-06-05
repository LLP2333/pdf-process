import type { PageInfo, Question, Segment } from "./api";

export type { PageInfo, Question, Segment };

/**
 * 用户在某页 PDF 上手动添加的水平分割线。
 *
 * 模型:文档默认是「一道大题」,用户每加一条分割线就在该 y 处把题目一分为二;
 * 相邻两条分割线(含文档首末隐式边界)之间的全部内容就是一道题。
 */
export interface Divider {
  id: string;
  page: number;
  y: number;
}

export interface AppDoc {
  docId: string;
  filename: string;
  pages: PageInfo[];
}
