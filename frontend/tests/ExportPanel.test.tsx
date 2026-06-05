import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ExportPanel from "../src/components/ExportPanel";

function renderPanel(opts?: {
  questions?: { no: number; segments: { page: number; y1: number; y2: number }[] }[];
  autoTrim?: boolean;
  onAutoTrim?: (v: boolean) => void;
}) {
  const onAutoTrim = opts?.onAutoTrim ?? (() => {});
  return render(
    <ExportPanel
      docId="abc"
      questions={opts?.questions ?? [{ no: 1, segments: [] }]}
      autoTrim={opts?.autoTrim ?? true}
      onAutoTrimChange={onAutoTrim}
    />
  );
}

describe("ExportPanel", () => {
  it("没有任何带段题目时,点击导出仅展示报错,不发起 fetch", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    renderPanel({ questions: [{ no: 1, segments: [] }] });

    fireEvent.click(screen.getByText(/导出 PDF/));
    expect(screen.getByText(/请先在 PDF 上添加分割线/)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("有有效题目时,发起 fetch 携带 auto_trim 字段并按响应展示成功提示", async () => {
    const blob = new Blob(["%PDF"], { type: "application/pdf" });
    const fname = encodeURIComponent("试卷切割重组.pdf");
    const fetchSpy = vi.fn(
      async () =>
        new Response(blob, {
          status: 200,
          headers: {
            "Content-Disposition": `attachment; filename*=UTF-8''${fname}`,
            "X-Question-Count": "2",
          },
        })
    );
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: () => "blob:fake",
      revokeObjectURL: () => undefined,
    });

    renderPanel({
      questions: [{ no: 1, segments: [{ page: 0, y1: 10, y2: 20 }] }],
      autoTrim: false,
    });
    fireEvent.click(screen.getByText(/导出 PDF/));

    expect(await screen.findByText(/已导出 2 道题/)).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("/api/export/abc");
    const body = JSON.parse(call[1].body as string);
    expect(body.format).toBe("pdf");
    expect(body.auto_trim).toBe(false);
    expect(body.questions).toHaveLength(1);
  });

  it("勾选/取消「自动去白边」会触发 onAutoTrimChange", () => {
    const onAutoTrim = vi.fn();
    renderPanel({ autoTrim: true, onAutoTrim });
    const cb = screen.getByLabelText(/自动去除题目上下白边/) as HTMLInputElement;
    expect(cb.checked).toBe(true);
    fireEvent.click(cb);
    expect(onAutoTrim).toHaveBeenCalledWith(false);
  });
});
