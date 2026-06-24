import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PreviewModal from "../src/components/PreviewModal";
import type { DerivedQuestion } from "../src/types";

const Q: DerivedQuestion[] = [
  { id: "a|b", no: 1, segments: [{ page: 0, y1: 100, y2: 400 }] },
  { id: "b|c", no: 2, segments: [{ page: 0, y1: 400, y2: 700 }] },
];

function renderModal(opts?: {
  open?: boolean;
  questions?: DerivedQuestion[];
  adjustments?: Record<string, { top: number; bottom: number }>;
  onAdj?: (id: string, adj: { top: number; bottom: number }) => void;
  excluded?: Record<string, true>;
  onToggleExcluded?: (id: string) => void;
  onClose?: () => void;
}) {
  return render(
    <PreviewModal
      open={opts?.open ?? true}
      docId="abc"
      sourceName="期中卷.pdf"
      derivedQuestions={opts?.questions ?? Q}
      autoTrim={true}
      margin={28}
      adjustments={opts?.adjustments ?? {}}
      onAdjustmentChange={opts?.onAdj ?? (() => {})}
      excludedQuestions={opts?.excluded ?? {}}
      onToggleExcluded={opts?.onToggleExcluded ?? (() => {})}
      onClose={opts?.onClose ?? (() => {})}
    />,
  );
}

describe("PreviewModal", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: () => "blob:preview-modal",
      revokeObjectURL: () => undefined,
    });
  });

  it("open=false 时不渲染", () => {
    const { container } = renderModal({ open: false });
    expect(container.querySelector(".modal-backdrop")).toBeNull();
  });

  it("打开后展示每题占位与渲染中的标签", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Blob(["x"], { type: "image/png" }), { status: 200 })),
    );
    renderModal();
    expect(screen.getByText(/试卷裁剪预览/)).toBeInTheDocument();
    expect(screen.getByText("第 1 题")).toBeInTheDocument();
    expect(screen.getByText("第 2 题")).toBeInTheDocument();
    const imgs = await screen.findAllByRole("img");
    expect(imgs.length).toBe(2);
  });

  it("修改「顶部再裁」会触发 onAdjustmentChange,带入正确题 id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Blob(["x"], { type: "image/png" }), { status: 200 })),
    );
    const onAdj = vi.fn();
    const { container } = renderModal({ onAdj });
    // 每题有 2 个 adj-row,顶部再裁是第一个;number input 在 range 之后
    const numberInputs = container.querySelectorAll<HTMLInputElement>(
      ".modal-card:first-of-type .adj-row:first-of-type input[type='number']",
    );
    expect(numberInputs.length).toBe(1);
    fireEvent.change(numberInputs[0], { target: { value: "12" } });
    expect(onAdj).toHaveBeenLastCalledWith("a|b", { top: 12, bottom: 0 });
  });

  it("点击关闭按钮触发 onClose", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob(["x"]), { status: 200 })));
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByLabelText("关闭"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("跨两页 + top/bottom 调整时,segments 不变,trim 作为字段一起发出去", async () => {
    const crossPageQ = [
      {
        id: "a|b",
        no: 1,
        segments: [
          { page: 0, y1: 300, y2: 842 },
          { page: 1, y1: 0, y2: 842 },
        ],
      },
    ];
    const previewBodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (typeof url === "string" && url.startsWith("/api/preview/")) {
          previewBodies.push(JSON.parse(init!.body as string));
        }
        return new Response(new Blob(["x"], { type: "image/png" }), { status: 200 });
      }),
    );
    renderModal({
      questions: crossPageQ,
      adjustments: { "a|b": { top: 12, bottom: 50 } },
    });
    await waitFor(() => expect(previewBodies.length).toBeGreaterThan(0));
    const body = previewBodies[previewBodies.length - 1] as {
      question: {
        segments: Array<{ page: number; y1: number; y2: number }>;
        trim?: { top: number; bottom: number };
      };
    };
    // 关键:前端不再 mutate segments,trim 单独传,由后端在 auto_trim 之后吃掉
    expect(body.question.segments).toEqual([
      { page: 0, y1: 300, y2: 842 },
      { page: 1, y1: 0, y2: 842 },
    ]);
    expect(body.question.trim).toEqual({ top: 12, bottom: 50 });
  });

  it("点击题号前的复选框会触发 onToggleExcluded,带入对应题 id", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Blob(["x"], { type: "image/png" }), { status: 200 })),
    );
    const onToggleExcluded = vi.fn();
    renderModal({ onToggleExcluded });
    // 第一题的复选框,通过 aria-label 定位
    const cb = screen.getByLabelText("第 1 题是否导出") as HTMLInputElement;
    expect(cb.checked).toBe(true); // 默认导出
    fireEvent.click(cb);
    expect(onToggleExcluded).toHaveBeenCalledWith("a|b");
  });

  it("被排除的题:卡片带 modal-card-excluded 类、复选框未勾选、显示「不导出」徽标", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Blob(["x"], { type: "image/png" }), { status: 200 })),
    );
    const { container } = renderModal({ excluded: { "a|b": true } });
    const card = container.querySelector(".modal-card:first-of-type");
    expect(card?.className).toContain("modal-card-excluded");
    const cb = screen.getByLabelText("第 1 题是否导出") as HTMLInputElement;
    expect(cb.checked).toBe(false);
    expect(screen.getByText("不导出")).toBeInTheDocument();
  });

  it("头部计数:有题被排除时显示「X / Y 道题将导出」", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Blob(["x"], { type: "image/png" }), { status: 200 })),
    );
    renderModal({ excluded: { "a|b": true } });
    expect(screen.getByText("1 / 2 道题将导出")).toBeInTheDocument();
  });

  it("全部题被排除:导出按钮禁用,文案带「(0)」", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Blob(["x"], { type: "image/png" }), { status: 200 })),
    );
    renderModal({ excluded: { "a|b": true, "b|c": true } });
    const pdfBtn = screen.getByText(/确认并导出 PDF \(0\)/) as HTMLButtonElement;
    const pptxBtn = screen.getByText(/导出 PPTX \(0\)/) as HTMLButtonElement;
    expect(pdfBtn.disabled).toBe(true);
    expect(pptxBtn.disabled).toBe(true);
  });

  it("导出请求:被排除的题不会出现在 questions 中,且剩余题号被重新连续编号", async () => {
    const blob = new Blob(["%PDF"], { type: "application/pdf" });
    const fname = encodeURIComponent("试卷切割重组.pdf");
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.startsWith("/api/preview/")) {
        return new Response(new Blob(["x"], { type: "image/png" }), { status: 200 });
      }
      return new Response(blob, {
        status: 200,
        headers: {
          "Content-Disposition": `attachment; filename*=UTF-8''${fname}`,
          "X-Question-Count": "1",
        },
      });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const anchor = {
      click: vi.fn(),
      remove: vi.fn(),
      set href(_v: string) {},
      set download(_v: string) {},
    } as unknown as HTMLAnchorElement;
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "a") return anchor;
      return origCreate(tag);
    });

    // 排除第 1 题,只导出第 2 题
    renderModal({ excluded: { "a|b": true } });
    fireEvent.click(screen.getByText(/确认并导出 PDF \(1\)/));

    await waitFor(() => {
      const has = fetchSpy.mock.calls.some(
        (c) => typeof c[0] === "string" && (c[0] as string).startsWith("/api/export/"),
      );
      expect(has).toBe(true);
    });
    const exportCall = fetchSpy.mock.calls.find(
      (c) => typeof c[0] === "string" && (c[0] as string).startsWith("/api/export/"),
    ) as unknown as [string, RequestInit];
    const body = JSON.parse(exportCall[1].body as string);
    expect(body.questions).toHaveLength(1);
    // 剩下的题被重新编号为 1
    expect(body.questions[0].no).toBe(1);
    expect(body.questions[0].segments[0]).toEqual({ page: 0, y1: 400, y2: 700 });
  });

  it("点导出按钮调用 /api/export 并把 trim 作为字段带到 question 上", async () => {
    const blob = new Blob(["%PDF"], { type: "application/pdf" });
    const fname = encodeURIComponent("试卷切割重组.pdf");
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.startsWith("/api/preview/")) {
        return new Response(new Blob(["x"], { type: "image/png" }), { status: 200 });
      }
      return new Response(blob, {
        status: 200,
        headers: {
          "Content-Disposition": `attachment; filename*=UTF-8''${fname}`,
          "X-Question-Count": "2",
        },
      });
    });
    vi.stubGlobal("fetch", fetchSpy);
    // jsdom 不实现导航
    const anchor = { click: vi.fn(), remove: vi.fn(), set href(_v: string) {}, set download(_v: string) {} } as unknown as HTMLAnchorElement;
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "a") return anchor;
      return origCreate(tag);
    });

    renderModal({ adjustments: { "a|b": { top: 25, bottom: 0 } } });
    fireEvent.click(screen.getByText(/确认并导出 PDF/));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const exportCall = fetchSpy.mock.calls.find(
      (c) => typeof c[0] === "string" && (c[0] as string).startsWith("/api/export/"),
    ) as unknown as [string, RequestInit] | undefined;
    expect(exportCall).toBeTruthy();
    const body = JSON.parse(exportCall![1].body as string);
    // 第一题 segments 不变,trim 单独带上
    expect(body.questions[0].segments[0]).toEqual({ page: 0, y1: 100, y2: 400 });
    expect(body.questions[0].trim).toEqual({ top: 25, bottom: 0 });
    // 第二题没有调整,trim 字段不应出现
    expect(body.questions[1].segments[0]).toEqual({ page: 0, y1: 400, y2: 700 });
    expect(body.questions[1].trim).toBeUndefined();
    expect(body.auto_trim).toBe(true);
    expect(body.margin).toBe(28);
    // 原始文件名随导出请求带上,供后端拼下载名
    expect(body.source_name).toBe("期中卷.pdf");
  });
});
