import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  uploadPdf,
  exportFile,
  previewQuestion,
  autoDetect,
  type ExportRequest,
  type Question,
} from "../src/api";

const DOC = "0123456789abcdef";

function question(no = 1): Question {
  return {
    no,
    regions: [{ doc_id: DOC, page: 0, x1: 0, y1: 0, x2: 100, y2: 50 }],
  };
}

describe("api.ts", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uploadPdf 成功时返回解析后的 JSON", async () => {
    const fakeResp = {
      doc_id: "abc",
      filename: "x.pdf",
      page_count: 1,
      pages: [{ index: 0, width: 595, height: 842, image_url: "/u", image_width: 1, image_height: 1 }],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(fakeResp), { status: 200 }))
    );
    const file = new File([new Uint8Array([1, 2, 3])], "x.pdf", { type: "application/pdf" });
    const res = await uploadPdf(file);
    expect(res.doc_id).toBe("abc");
  });

  it("uploadPdf 失败时抛出后端 detail 文案", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ detail: "仅支持 PDF 文件" }), { status: 400 }))
    );
    const file = new File([new Uint8Array([1])], "a.txt", { type: "text/plain" });
    await expect(uploadPdf(file)).rejects.toThrow("仅支持 PDF 文件");
  });

  it("exportFile 走 /api/export 且请求体带 footer_text 与 regions", async () => {
    const blob = new Blob(["%PDF-1.4..."], { type: "application/pdf" });
    const filename = encodeURIComponent("试卷切割重组.pdf");
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(blob, {
          status: 200,
          headers: {
            "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
            "X-Question-Count": "3",
          },
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    const payload: ExportRequest = {
      format: "pdf",
      margin: 28,
      auto_trim: true,
      footer_text: "整理:张老师",
      footer_size: 14,
      questions: [question()],
    };
    const res = await exportFile(payload);
    expect(res.filename).toBe("试卷切割重组.pdf");
    expect(res.count).toBe(3);

    expect(fetchMock).toHaveBeenCalledWith("/api/export", expect.anything());
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.footer_text).toBe("整理:张老师");
    expect(body.footer_size).toBe(14);
    expect(body.questions[0].regions[0]).toMatchObject({ doc_id: DOC, x1: 0, x2: 100 });
  });

  it("exportFile 当响应无文件名头时回退到默认名", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("xx", { status: 200 }))
    );
    const r = await exportFile({
      format: "pptx",
      margin: 28,
      auto_trim: true,
      questions: [question()],
    });
    expect(r.filename).toBe("试卷切割重组.pptx");
  });

  it("exportFile 无文件名头但有 source_name 时按 <原名>_切割重组 兜底", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("xx", { status: 200 }))
    );
    const r = await exportFile({
      format: "pdf",
      margin: 28,
      auto_trim: true,
      source_name: "2024期末数学.pdf",
      questions: [question()],
    });
    expect(r.filename).toBe("2024期末数学_切割重组.pdf");
  });

  it("exportFile 失败时抛出错误", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ detail: "文档不存在或已过期" }), { status: 404 }))
    );
    await expect(
      exportFile({
        format: "pdf",
        margin: 28,
        auto_trim: true,
        questions: [question()],
      })
    ).rejects.toThrow("文档不存在或已过期");
  });

  it("previewQuestion 走 /api/preview 返回 object URL,空响应保留 empty=true", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: () => "blob:fake-url",
      revokeObjectURL: () => undefined,
    });
    const fetchMock = vi.fn(
      async () =>
        new Response(blob, {
          status: 200,
          headers: { "X-Empty": "1" },
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    const r = await previewQuestion({ question: question(), auto_trim: true });
    expect(r.url).toBe("blob:fake-url");
    expect(r.empty).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("/api/preview", expect.anything());
  });

  it("previewQuestion 失败时抛出后端 detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ detail: "文档不存在或已过期" }), { status: 404 }))
    );
    await expect(
      previewQuestion({ question: question(), auto_trim: true })
    ).rejects.toThrow("文档不存在或已过期");
  });

  it("autoDetect 成功返回 dividers 列表(文字版)", async () => {
    const body = {
      is_text: true,
      page_count: 2,
      char_count: 320,
      dividers: [
        { page: 0, y: 80 },
        { page: 0, y: 240 },
        { page: 1, y: 400 },
      ],
      message: "已自动识别到 2 道题",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
    );
    const r = await autoDetect("doc1");
    expect(r.is_text).toBe(true);
    expect(r.dividers).toHaveLength(3);
  });

  it("autoDetect 扫描件返回 is_text=false + 空 dividers", async () => {
    const body = {
      is_text: false,
      page_count: 4,
      char_count: 3,
      dividers: [],
      message: "该 PDF 似乎是扫描件",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
    );
    const r = await autoDetect("doc1");
    expect(r.is_text).toBe(false);
    expect(r.dividers).toEqual([]);
    expect(r.message).toContain("扫描件");
  });

  it("autoDetect 失败时抛出后端 detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ detail: "文档不存在或已过期" }), { status: 404 })),
    );
    await expect(autoDetect("missing")).rejects.toThrow("文档不存在或已过期");
  });
});
