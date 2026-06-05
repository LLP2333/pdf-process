import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import QuestionList from "../src/components/QuestionList";
import type { DerivedQuestion } from "../src/types";

function mk(id: string, no: number, segments: DerivedQuestion["segments"]): DerivedQuestion {
  return { id, no, segments };
}

describe("QuestionList", () => {
  it("没有分割线时提示需要分割线", () => {
    render(
      <QuestionList
        questions={[]}
        activeQuestionIndex={null}
        onSelectQuestion={() => {}}
        onClearDividers={() => {}}
        dividerCount={0}
        adjustments={{}}
      />,
    );
    expect(screen.getByText(/还没有分割线/)).toBeInTheDocument();
    expect(screen.getByText(/会被自动忽略/)).toBeInTheDocument();
  });

  it("只有 1 条分割线时提示再加一条", () => {
    render(
      <QuestionList
        questions={[]}
        activeQuestionIndex={null}
        onSelectQuestion={() => {}}
        onClearDividers={() => {}}
        dividerCount={1}
        adjustments={{}}
      />,
    );
    expect(screen.getByText(/再加 1 条/)).toBeInTheDocument();
  });

  it("展示每题的页面跨度,「跨 N 页」与单页文案不同", () => {
    render(
      <QuestionList
        questions={[
          mk("a|b", 1, [{ page: 0, y1: 100, y2: 200 }]),
          mk("b|c", 2, [
            { page: 0, y1: 200, y2: 842 },
            { page: 1, y1: 0, y2: 300 },
          ]),
        ]}
        activeQuestionIndex={0}
        onSelectQuestion={() => {}}
        onClearDividers={() => {}}
        dividerCount={3}
        adjustments={{}}
      />,
    );
    expect(screen.getByText("第 1 题")).toBeInTheDocument();
    expect(screen.getByText("第 2 题")).toBeInTheDocument();
    expect(screen.getByText(/第 1 页/)).toBeInTheDocument();
    expect(screen.getByText(/跨 2 页\(p1,p2\)/)).toBeInTheDocument();
  });

  it("有二次裁剪的题目展示 ✎ 角标", () => {
    render(
      <QuestionList
        questions={[mk("a|b", 1, [{ page: 0, y1: 100, y2: 200 }])]}
        activeQuestionIndex={null}
        onSelectQuestion={() => {}}
        onClearDividers={() => {}}
        dividerCount={2}
        adjustments={{ "a|b": { top: 5, bottom: 0 } }}
      />,
    );
    expect(screen.getByText("✎")).toBeInTheDocument();
  });

  it("dividerCount=0 时清空按钮被禁用", () => {
    render(
      <QuestionList
        questions={[]}
        activeQuestionIndex={null}
        onSelectQuestion={() => {}}
        onClearDividers={() => {}}
        dividerCount={0}
        adjustments={{}}
      />,
    );
    const btn = screen.getByText("清空分割线") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("点击题目卡片触发 onSelectQuestion(qi)", () => {
    const onSelect = vi.fn();
    render(
      <QuestionList
        questions={[
          mk("a|b", 1, [{ page: 0, y1: 0, y2: 100 }]),
          mk("b|c", 2, [{ page: 0, y1: 100, y2: 200 }]),
        ]}
        activeQuestionIndex={null}
        onSelectQuestion={onSelect}
        onClearDividers={() => {}}
        dividerCount={3}
        adjustments={{}}
      />,
    );
    fireEvent.click(screen.getByText("第 2 题"));
    expect(onSelect).toHaveBeenCalledWith(1);
  });
});
