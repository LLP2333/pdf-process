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

export interface Question {
  no: number;
  segments: Segment[];
}

export type ExportFormat = "pdf" | "pptx";

export interface ExportRequest {
  format: ExportFormat;
  margin: number;
  questions: Question[];
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

async function safeError(resp: Response): Promise<string> {
  try {
    const data = await resp.json();
    return typeof data?.detail === "string" ? data.detail : JSON.stringify(data);
  } catch {
    return `请求失败 (${resp.status})`;
  }
}
