import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { uploadPdf, exportFile, previewQuestion, type ExportRequest } from "../src/api";

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

  it("exportFile 解析 Content-Disposition 中的中文文件名", async () => {
    const blob = new Blob(["%PDF-1.4..."], { type: "application/pdf" });
    const filename = encodeURIComponent("试卷切割重组.pdf");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(blob, {
            status: 200,
            headers: {
              "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
              "X-Question-Count": "3",
            },
          })
      )
    );
    const payload: ExportRequest = {
      format: "pdf",
      margin: 28,
      auto_trim: true,
      questions: [{ no: 1, segments: [{ page: 0, y1: 0, y2: 10 }] }],
    };
    const res = await exportFile("doc1", payload);
    expect(res.filename).toBe("试卷切割重组.pdf");
    expect(res.count).toBe(3);
  });

  it("exportFile 当响应无文件名头时回退到默认名", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("xx", { status: 200 }))
    );
    const r = await exportFile("d", {
      format: "pptx",
      margin: 28,
      auto_trim: true,
      questions: [{ no: 1, segments: [{ page: 0, y1: 0, y2: 10 }] }],
    });
    expect(r.filename).toBe("试卷切割重组.pptx");
  });

  it("exportFile 无文件名头但有 source_name 时按 <原名>_切割重组 兜底", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("xx", { status: 200 }))
    );
    const r = await exportFile("d", {
      format: "pdf",
      margin: 28,
      auto_trim: true,
      source_name: "2024期末数学.pdf",
      questions: [{ no: 1, segments: [{ page: 0, y1: 0, y2: 10 }] }],
    });
    expect(r.filename).toBe("2024期末数学_切割重组.pdf");
  });

  it("exportFile 失败时抛出错误", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ detail: "文档不存在或已过期" }), { status: 404 }))
    );
    await expect(
      exportFile("missing", {
        format: "pdf",
        margin: 28,
        auto_trim: true,
        questions: [{ no: 1, segments: [{ page: 0, y1: 0, y2: 10 }] }],
      })
    ).rejects.toThrow("文档不存在或已过期");
  });

  it("previewQuestion 返回 object URL,空响应保留 empty=true", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: () => "blob:fake-url",
      revokeObjectURL: () => undefined,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(blob, {
            status: 200,
            headers: { "X-Empty": "1" },
          })
      )
    );
    const r = await previewQuestion("doc1", {
      question: { no: 1, segments: [{ page: 0, y1: 0, y2: 10 }] },
      auto_trim: true,
    });
    expect(r.url).toBe("blob:fake-url");
    expect(r.empty).toBe(true);
  });

  it("previewQuestion 失败时抛出后端 detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ detail: "文档不存在或已过期" }), { status: 404 }))
    );
    await expect(
      previewQuestion("missing", {
        question: { no: 1, segments: [{ page: 0, y1: 0, y2: 10 }] },
        auto_trim: true,
      })
    ).rejects.toThrow("文档不存在或已过期");
  });
});
