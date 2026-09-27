export interface PageInfo {
  index: number;
  width: number;
  height: number;
  image_url: string;
  image_width: number;
  image_height: number;
}

export interface UploadResponse {
  doc_id: string;
  filename: string;
  page_count: number;
  pages: PageInfo[];
}

/** 一道题在某份文档某一页上的矩形裁剪区域(pt,PDF 原始坐标)。 */
export interface Region {
  doc_id: string;
  page: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Question {
  no: number;
  regions: Region[];
}

export type ExportFormat = "pdf" | "pptx";

export interface ExportRequest {
  format: ExportFormat;
  /** 题目下方至少预留的留白,占页高百分比(0-80);左 / 右 / 上固定 28pt。 */
  bottom_space: number;
  auto_trim: boolean;
  /** 可选页脚署名:导出的每页/每张幻灯片左下角灰字;留空不加。 */
  footer_text?: string;
  /** 署名字号(pt,6-24,默认 8);仅在 footer_text 非空时有意义。 */
  footer_size?: number;
  /** 上传时的原始文件名,后端据此拼出下载名 `<原名>_切割重组.<ext>`。 */
  source_name?: string;
  questions: Question[];
}

export interface PreviewRequest {
  question: Question;
  auto_trim: boolean;
}

export interface PreviewResult {
  /** 渲染好的 PNG 的 object URL,前端用完后应当 revoke */
  url: string;
  /** 后端为「该题无有效区域」时返回 1x1 占位图并附带此字段 */
  empty: boolean;
}

/** 自动识别返回的草稿分割线;前端把相邻两条转换成整页宽的草稿题框。 */
export interface DividerSuggestion {
  page: number;
  y: number;
}

/** 与后端 `AutoDetectResponse` 对齐的响应模型。 */
export interface AutoDetectResponse {
  is_text: boolean;
  page_count: number;
  char_count: number;
  dividers: DividerSuggestion[];
  message: string;
}

const API = "/api";

/**
 * 上传一份 PDF,后端落盘并逐页渲染预览 PNG。
 *
 * 多文档组卷就是多次调用本接口:每份文件各得一个独立 `doc_id`,
 * 后续框选区域自带 `doc_id`,导出时可自由混排。
 */
export async function uploadPdf(file: File): Promise<UploadResponse> {
  const fd = new FormData();
  fd.append("file", file);
  const resp = await fetch(`${API}/upload`, { method: "POST", body: fd });
  if (!resp.ok) {
    const msg = await safeError(resp);
    throw new Error(msg);
  }
  return resp.json();
}

/**
 * 调用 `POST /api/export` 导出 PDF / PPTX。
 *
 * 区域自带 `doc_id`,因此路由不再绑定单一文档;任一 doc 过期后端会整体 404。
 * 下载名优先取响应头 `Content-Disposition`(后端按 `<原名>_切割重组.<ext>` 给出);
 * 若响应头缺失,则在前端按 `payload.source_name` 兜底拼一个同样规则的名字,
 * 实在没有原名时退回固定名 `试卷切割重组.<ext>`。
 */
export async function exportFile(
  payload: ExportRequest
): Promise<{ blob: Blob; filename: string; count: number }> {
  const resp = await fetch(`${API}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const msg = await safeError(resp);
    throw new Error(msg);
  }
  const cd = resp.headers.get("Content-Disposition") || "";
  const count = Number(resp.headers.get("X-Question-Count") || "0");
  const m = cd.match(/filename\*=UTF-8''([^;]+)/i) || cd.match(/filename="?([^";]+)"?/i);
  const filename = m ? decodeURIComponent(m[1]) : fallbackName(payload);
  const blob = await resp.blob();
  return { blob, filename, count };
}

/** Content-Disposition 缺失时的兜底下载名,规则与后端 `_download_name` 保持一致。 */
function fallbackName(payload: ExportRequest): string {
  const ext = payload.format === "pdf" ? "pdf" : "pptx";
  let stem = (payload.source_name ?? "").replace(/\\/g, "/").split("/").pop()?.trim() ?? "";
  if (stem.toLowerCase().endsWith(".pdf")) stem = stem.slice(0, -4);
  stem = stem.replace(/[\\/:*?"<>|\x00-\x1f]/g, "").trim();
  return stem ? `${stem}_切割重组.${ext}` : `试卷切割重组.${ext}`;
}

/**
 * 拉取单题的实时预览图(`POST /api/preview`)。
 *
 * 一道题的区域可以横跨多份文档,后端会按序纵向拼接成一张 PNG。
 * 当一题没有任何有效区域时,后端返回 1x1 占位 PNG 并带响应头 `X-Empty: 1`,
 * 前端据此显示空态文案。调用方负责在不再需要时 `URL.revokeObjectURL(url)`。
 */
export async function previewQuestion(payload: PreviewRequest): Promise<PreviewResult> {
  const resp = await fetch(`${API}/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const msg = await safeError(resp);
    throw new Error(msg);
  }
  const empty = resp.headers.get("X-Empty") === "1";
  const blob = await resp.blob();
  return { url: URL.createObjectURL(blob), empty };
}

/**
 * 调用 `POST /api/auto_detect/{docId}` 让后端识别题号 → 给出草稿分割线。
 *
 * 后端会先做"扫描件 vs 文字版"判定:
 * - 扫描件 → `is_text=false`,`dividers=[]`,前端应展示 `message` 并保持现有题框;
 * - 文字版 + 识别到 ≥2 个题号 → `dividers` 含 N+1 条(N 题首 + 末题底界),
 *   前端把相邻两条转换成整页宽草稿题框;
 * - 文字版但识别失败(题号链 < 2) → `dividers=[]` + 解释性 `message`。
 *
 * 接口本身不抛 4xx 区分上述三种"业务结果",仅在 doc 不存在时 404 / 服务器异常 5xx。
 */
export async function autoDetect(docId: string): Promise<AutoDetectResponse> {
  const resp = await fetch(`${API}/auto_detect/${docId}`, { method: "POST" });
  if (!resp.ok) {
    const msg = await safeError(resp);
    throw new Error(msg);
  }
  return resp.json();
}

async function safeError(resp: Response): Promise<string> {
  try {
    const data = await resp.json();
    return typeof data?.detail === "string" ? data.detail : JSON.stringify(data);
  } catch {
    return `请求失败 (${resp.status})`;
  }
}
