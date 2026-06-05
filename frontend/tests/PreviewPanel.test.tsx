import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import PreviewPanel from "../src/components/PreviewPanel";

describe("PreviewPanel", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: () => "blob:preview",
      revokeObjectURL: () => undefined,
    });
  });

  it("没有题目时展示引导文案", () => {
    render(
      <PreviewPanel
        docId="abc"
        questions={[]}
        autoTrim={true}
        activeQuestionIndex={null}
        onSelectQuestion={() => {}}
      />
    );
    expect(screen.getByText(/添加分割线后/)).toBeInTheDocument();
  });

  it("有题目时通过 fetch 拉取预览并渲染图片", async () => {
    const fetchSpy = vi.fn(
      async () => new Response(new Blob([new Uint8Array([1])], { type: "image/png" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <PreviewPanel
        docId="abc"
        questions={[
          { no: 1, segments: [{ page: 0, y1: 0, y2: 100 }] },
          { no: 2, segments: [{ page: 0, y1: 100, y2: 200 }] },
        ]}
        autoTrim={true}
        activeQuestionIndex={null}
        onSelectQuestion={() => {}}
      />
    );

    expect(screen.getByText("第 1 题")).toBeInTheDocument();
    expect(screen.getByText("第 2 题")).toBeInTheDocument();

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    const imgs = await screen.findAllByRole("img");
    expect(imgs.length).toBe(2);
    for (const img of imgs) {
      expect(img.getAttribute("src")).toBe("blob:preview");
    }
  });

  it("点击预览卡触发 onSelectQuestion(qi)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob(["x"], { type: "image/png" }))));
    const onSel = vi.fn();
    render(
      <PreviewPanel
        docId="abc"
        questions={[{ no: 1, segments: [{ page: 0, y1: 0, y2: 100 }] }]}
        autoTrim={true}
        activeQuestionIndex={null}
        onSelectQuestion={onSel}
      />
    );
    fireEvent.click(screen.getByText("第 1 题"));
    expect(onSel).toHaveBeenCalledWith(0);
  });

  it("后端返回 X-Empty 时展示空态文案", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Blob(["x"], { type: "image/png" }), {
            status: 200,
            headers: { "X-Empty": "1" },
          })
      )
    );
    render(
      <PreviewPanel
        docId="abc"
        questions={[{ no: 1, segments: [{ page: 99, y1: 0, y2: 100 }] }]}
        autoTrim={true}
        activeQuestionIndex={null}
        onSelectQuestion={() => {}}
      />
    );
    expect(await screen.findByText(/该题无有效内容/)).toBeInTheDocument();
  });
});
