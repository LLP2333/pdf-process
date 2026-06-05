import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import QuestionList from "../src/components/QuestionList";

describe("QuestionList", () => {
  it("没有分割线时展示引导文案", () => {
    render(
      <QuestionList
        questions={[]}
        activeQuestionIndex={null}
        onSelectQuestion={() => {}}
        onClearDividers={() => {}}
        dividerCount={0}
      />
    );
    expect(screen.getByText(/还没有分割线/)).toBeInTheDocument();
  });

  it("展示每道题与其范围,点击「清空分割线」触发回调", () => {
    const onClear = vi.fn();
    render(
      <QuestionList
        questions={[
          { no: 1, segments: [{ page: 0, y1: 100, y2: 200 }] },
          {
            no: 2,
            segments: [
              { page: 0, y1: 200, y2: 842 },
              { page: 1, y1: 0, y2: 300 },
            ],
          },
        ]}
        activeQuestionIndex={0}
        onSelectQuestion={() => {}}
        onClearDividers={onClear}
        dividerCount={2}
      />
    );
    expect(screen.getByText("第 1 题")).toBeInTheDocument();
    expect(screen.getByText("第 2 题")).toBeInTheDocument();
    expect(screen.getByText(/p1 100→200pt/)).toBeInTheDocument();
    expect(screen.getByText(/p1 200→842pt · p2 0→300pt/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("清空分割线"));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("dividerCount 为 0 时,清空分割线按钮被禁用", () => {
    render(
      <QuestionList
        questions={[{ no: 1, segments: [{ page: 0, y1: 0, y2: 842 }] }]}
        activeQuestionIndex={null}
        onSelectQuestion={() => {}}
        onClearDividers={() => {}}
        dividerCount={0}
      />
    );
    const btn = screen.getByText("清空分割线") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("点击题目卡片触发 onSelectQuestion(qi)", () => {
    const onSelect = vi.fn();
    render(
      <QuestionList
        questions={[
          { no: 1, segments: [{ page: 0, y1: 100, y2: 200 }] },
          { no: 2, segments: [{ page: 1, y1: 0, y2: 200 }] },
        ]}
        activeQuestionIndex={null}
        onSelectQuestion={onSelect}
        onClearDividers={() => {}}
        dividerCount={1}
      />
    );
    fireEvent.click(screen.getByText("第 2 题"));
    expect(onSelect).toHaveBeenCalledWith(1);
  });
});
