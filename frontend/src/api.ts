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

export interface Segment {
  page: number;
  y1: number;
  y2: number;
}

/** 题目级别的"二次裁剪",与后端 `QuestionTrim` 对齐;在 `auto_trim` **之后**生效。 */
export interface QuestionTrim {
  top: number;
  bottom: number;
}

export interface Question {
  no: number;
  segments: Segment[];
  trim?: QuestionTrim;
}

export type ExportFormat = "pdf" | "pptx";

export interface ExportRequest {
  format: ExportFormat;
  margin: number;
  auto_trim: boolean;
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

const API = "/api";

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

export async function exportFile(
  docId: string,
  payload: ExportRequest
): Promise<{ blob: Blob; filename: string; count: number }> {
  const resp = await fetch(`${API}/export/${docId}`, {
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
  const filename = m
    ? decodeURIComponent(m[1])
    : payload.format === "pdf"
      ? "试卷切割重组.pdf"
      : "试卷切割重组.pptx";
  const blob = await resp.blob();
  return { blob, filename, count };
}

/**
 * 拉取单题的实时预览图。
 *
 * 调用 `POST /api/preview/{docId}`,响应 `image/png`。当一题没有任何有效段时,
 * 后端会返回一张 1x1 占位 PNG 并带响应头 `X-Empty: 1`,前端据此显示空态文案。
 * 调用方负责在不再需要时 `URL.revokeObjectURL(url)`。
 */
export async function previewQuestion(
  docId: string,
  payload: PreviewRequest,
): Promise<PreviewResult> {
  const resp = await fetch(`${API}/preview/${docId}`, {
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

async function safeError(resp: Response): Promise<string> {
  try {
    const data = await resp.json();
    return typeof data?.detail === "string" ? data.detail : JSON.stringify(data);
  } catch {
    return `请求失败 (${resp.status})`;
  }
}
