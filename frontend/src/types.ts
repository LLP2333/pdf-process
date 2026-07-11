import type { PageInfo, Question, Region } from "./api";

export type { PageInfo, Question, Region };

/**
 * 编辑器内的矩形区域:后端 `Region` + 前端稳定 id。
 *
 * 坐标恒为 PDF 原始坐标(pt),且保持 `x1<x2`、`y1<y2` 的规范形
 * (画框结束时即归一,后续移动/缩放只会产生规范形)。
 */
export interface EditorRegion {
  id: string;
  docId: string;
  page: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * 编辑器内的一道题:1..N 个区域按序纵向堆叠。
 *
 * `excluded` 为 true 时该题不参与导出(题目面板里的复选框),
 * 但仍显示在画布与面板中,便于随时恢复。
 */
export interface EditorQuestion {
  id: string;
  regions: EditorRegion[];
  excluded?: boolean;
}

/** 已上传的一份文档(多文档组卷时 rail 里的一项)。 */
export interface DocEntry {
  docId: string;
  filename: string;
  pages: PageInfo[];
}

/** 画布中的当前选中:精确到区域(题目 id 冗余存放,省一次反查)。 */
export interface Selection {
  questionId: string;
  regionId: string;
}
