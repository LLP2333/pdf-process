import type { PageInfo, Question, Segment } from "./api";

export type { PageInfo, Question, Segment };

export interface ActiveLine {
  questionIndex: number;
  segmentIndex: number;
  edge: "y1" | "y2";
}

export interface AppDoc {
  docId: string;
  filename: string;
  pages: PageInfo[];
}
