import type { PageInfo, Question, Segment } from "./api";

export type { PageInfo, Question, Segment };

/**
 * 用户在某页 PDF 上手动添加的水平分割线。
 *
 * 模型:每道题需要"上下两条分割线"。N 条分割线 ⇒ N-1 道题;
 * 第一条线以上的内容、最后一条线以下的内容都不算题(用户可借此排除页眉/页脚/页码)。
 */
export interface Divider {
  id: string;
  page: number;
  y: number;
}

/** 派生题目:在后端契约 `Question` 之外附带一个稳定 id,用于挂载二次裁剪等本地状态。 */
export interface DerivedQuestion extends Question {
  /** 稳定 id:由派生它的两条分割线 id 拼接而成,删任意一条 ⇒ 旧 id 自然失效。 */
  id: string;
}

/** 单题的「二次裁剪」调整:在派生 segments 的基础上,顶部/底部各再向内裁掉指定 pt。 */
export interface Adjustment {
  top: number;
  bottom: number;
}

export interface AppDoc {
  docId: string;
  filename: string;
  pages: PageInfo[];
}
