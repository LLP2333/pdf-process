import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import QuestionPanel from "../src/components/QuestionPanel";
import type { DocEntry, EditorQuestion } from "../src/types";

vi.mock("../src/api", () => ({
  previewQuestion: vi.fn(async () => ({ url: "blob:preview-1", empty: false })),
}));

import { previewQuestion } from "../src/api";

const DOC_A = "aaaaaaaaaaaaaaaa";
const DOC_B = "bbbbbbbbbbbbbbbb";

const docs: DocEntry[] = [
  {
    docId: DOC_A,
    filename: "a.pdf",
    pages: [
      { index: 0, width: 595, height: 842, image_url: "/a0", image_width: 10, image_height: 14 },
    ],
  },
  {
    docId: DOC_B,
    filename: "b.pdf",
    pages: [
      { index: 0, width: 595, height: 842, image_url: "/b0", image_width: 10, image_height: 14 },
    ],
  },
];

function makeQuestion(id: string, overrides: Partial<EditorQuestion> = {}): EditorQuestion {
  return {
    id,
    regions: [{ id: `${id}-r1`, docId: DOC_A, page: 0, x1: 10, y1: 10, x2: 200, y2: 100 }],
    ...overrides,
  };
}

function noop() {}

describe("QuestionPanel", () => {
  beforeEach(() => {
    vi.mocked(previewQuestion).mockClear();
  });

  it("无题目时显示框选引导文案", () => {
    render(
      <QuestionPanel
        questions={[]}
        docs={docs}
        autoTrim
        selection={null}
        onSelectQuestion={noop}
        onToggleExcluded={noop}
        onDeleteQuestion={noop}
        onMoveQuestion={noop}
      />,
    );
    expect(screen.getByText(/按住鼠标拖拽/)).toBeInTheDocument();
  });

  it("渲染题目卡片:题号、多文档徽标、跨区域信息,并在防抖后拉取预览", async () => {
    const q1 = makeQuestion("q1");
    const q2: EditorQuestion = {
      id: "q2",
      regions: [
        { id: "q2-r1", docId: DOC_A, page: 0, x1: 0, y1: 200, x2: 300, y2: 400 },
        { id: "q2-r2", docId: DOC_B, page: 0, x1: 0, y1: 0, x2: 300, y2: 120 },
      ],
    };
    render(
      <QuestionPanel
        questions={[q1, q2]}
        docs={docs}
        autoTrim
        selection={null}
        onSelectQuestion={noop}
        onToggleExcluded={noop}
        onDeleteQuestion={noop}
        onMoveQuestion={noop}
      />,
    );
    expect(screen.getByText("2 题")).toBeInTheDocument();
    expect(screen.getByText(/卷 A\+B/)).toBeInTheDocument();
    expect(screen.getByText(/2 块区域/)).toBeInTheDocument();

    await waitFor(() => expect(previewQuestion).toHaveBeenCalledTimes(2), { timeout: 2000 });
    const firstPayload = vi.mocked(previewQuestion).mock.calls[0][0];
    expect(firstPayload.question.regions[0]).toMatchObject({ doc_id: DOC_A, page: 0 });
    await waitFor(() =>
      expect(screen.getAllByAltText(/题预览/).length).toBeGreaterThan(0),
    );
  });

  it("excluded 题目显示不导出徽标,勾选/删除回调被正确触发", async () => {
    const onToggle = vi.fn();
    const onDelete = vi.fn();
    const onSelect = vi.fn();
    const q1 = makeQuestion("q1", { excluded: true });
    render(
      <QuestionPanel
        questions={[q1]}
        docs={docs}
        autoTrim
        selection={null}
        onSelectQuestion={onSelect}
        onToggleExcluded={onToggle}
        onDeleteQuestion={onDelete}
        onMoveQuestion={noop}
      />,
    );
    expect(screen.getByText("不导出")).toBeInTheDocument();
    expect(screen.getByText(/0 \/ 1 题将导出/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: /第 1 题是否导出/ }));
    expect(onToggle).toHaveBeenCalledWith("q1");

    fireEvent.click(screen.getByRole("button", { name: /删除第 1 题/ }));
    expect(onDelete).toHaveBeenCalledWith("q1");
    // 点击操作按钮不应冒泡成"选中题目"
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("不导出"));
    expect(onSelect).toHaveBeenCalledWith("q1");
  });

  it("区域全部失效(文档已移除)的题目显示空态而不是发请求", async () => {
    const orphan: EditorQuestion = {
      id: "q1",
      regions: [{ id: "r1", docId: "gone000000000000", page: 0, x1: 0, y1: 0, x2: 100, y2: 50 }],
    };
    render(
      <QuestionPanel
        questions={[orphan]}
        docs={docs}
        autoTrim
        selection={null}
        onSelectQuestion={noop}
        onToggleExcluded={noop}
        onDeleteQuestion={noop}
        onMoveQuestion={noop}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/区域太小或已失效/)).toBeInTheDocument(),
    );
    expect(previewQuestion).not.toHaveBeenCalled();
  });
});
