import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import QuestionList from "../src/components/QuestionList";

describe("QuestionList", () => {
  it("空题目时展示引导文案", () => {
    render(
      <QuestionList
        questions={[]}
        activeQuestion={null}
        activeSegment={null}
        onSelectSegment={() => {}}
        onAddQuestion={() => {}}
        onRemoveQuestion={() => {}}
        onRemoveSegment={() => {}}
        onRenumber={() => {}}
      />
    );
    expect(screen.getByText(/还没有题目/)).toBeInTheDocument();
  });

  it("展示每道题与段,点击「新增题目」触发回调", () => {
    const onAdd = vi.fn();
    render(
      <QuestionList
        questions={[
          { no: 1, segments: [{ page: 0, y1: 100, y2: 200 }] },
          { no: 2, segments: [] },
        ]}
        activeQuestion={0}
        activeSegment={0}
        onSelectSegment={() => {}}
        onAddQuestion={onAdd}
        onRemoveQuestion={() => {}}
        onRemoveSegment={() => {}}
        onRenumber={() => {}}
      />
    );
    expect(screen.getByText("第 1 题")).toBeInTheDocument();
    expect(screen.getByText("第 2 题")).toBeInTheDocument();
    expect(screen.getByText(/y 100 → 200 pt/)).toBeInTheDocument();
    expect(screen.getByText(/无段/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("+ 新增题目"));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("点击段触发 onSelectSegment(qi,si)", () => {
    const onSelect = vi.fn();
    render(
      <QuestionList
        questions={[{ no: 1, segments: [{ page: 0, y1: 100, y2: 200 }] }]}
        activeQuestion={null}
        activeSegment={null}
        onSelectSegment={onSelect}
        onAddQuestion={() => {}}
        onRemoveQuestion={() => {}}
        onRemoveSegment={() => {}}
        onRenumber={() => {}}
      />
    );
    fireEvent.click(screen.getByText(/y 100 → 200 pt/));
    expect(onSelect).toHaveBeenCalledWith(0, 0);
  });
});
