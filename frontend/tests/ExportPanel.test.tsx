import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ExportPanel from "../src/components/ExportPanel";

function renderPanel(opts?: {
  questionCount?: number;
  autoTrim?: boolean;
  onAutoTrim?: (v: boolean) => void;
  margin?: number;
  onMargin?: (v: number) => void;
  onOpenPreview?: () => void;
  onCollapse?: () => void;
  onAutoDetect?: () => void;
  autoDetecting?: boolean;
  autoDetectMessage?: { text: string; tone: "info" | "warn" | "error" } | null;
}) {
  return render(
    <ExportPanel
      questionCount={opts?.questionCount ?? 0}
      autoTrim={opts?.autoTrim ?? true}
      onAutoTrimChange={opts?.onAutoTrim ?? (() => {})}
      margin={opts?.margin ?? 28}
      onMarginChange={opts?.onMargin ?? (() => {})}
      onOpenPreview={opts?.onOpenPreview ?? (() => {})}
      onCollapse={opts?.onCollapse ?? (() => {})}
      onAutoDetect={opts?.onAutoDetect ?? (() => {})}
      autoDetecting={opts?.autoDetecting ?? false}
      autoDetectMessage={opts?.autoDetectMessage ?? null}
    />,
  );
}

describe("ExportPanel", () => {
  it("没有题目时按钮被禁用,文案提示先添加分割线", () => {
    renderPanel({ questionCount: 0 });
    const btn = screen.getByText(/请先添加分割线/) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("有题目时按钮可点击,展示题数 + 触发 onOpenPreview", () => {
    const open = vi.fn();
    renderPanel({ questionCount: 3, onOpenPreview: open });
    const btn = screen.getByText(/预览裁剪效果 \(3 题\)/) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("勾选「自动去白边」会触发 onAutoTrimChange", () => {
    const onAutoTrim = vi.fn();
    renderPanel({ autoTrim: true, onAutoTrim });
    const cb = screen.getByLabelText(/自动去除题目上下白边/) as HTMLInputElement;
    expect(cb.checked).toBe(true);
    fireEvent.click(cb);
    expect(onAutoTrim).toHaveBeenCalledWith(false);
  });

  it("点击折叠按钮会触发 onCollapse", () => {
    const onCollapse = vi.fn();
    renderPanel({ onCollapse });
    fireEvent.click(screen.getByLabelText(/折叠导出参数与题目面板/));
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it("修改页边距会触发 onMarginChange,数值被夹到 0-120", () => {
    const onMargin = vi.fn();
    renderPanel({ margin: 28, onMargin });
    const input = screen.getByLabelText(/页边距/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "300" } });
    expect(onMargin).toHaveBeenLastCalledWith(120);
    fireEvent.change(input, { target: { value: "-5" } });
    expect(onMargin).toHaveBeenLastCalledWith(0);
  });

  it("点击「自动识别题号」会触发 onAutoDetect", () => {
    const onAutoDetect = vi.fn();
    renderPanel({ onAutoDetect });
    fireEvent.click(screen.getByText(/自动识别题号/));
    expect(onAutoDetect).toHaveBeenCalledTimes(1);
  });

  it("autoDetecting=true 时按钮文案变为「识别中…」且被禁用", () => {
    renderPanel({ autoDetecting: true });
    const btn = screen.getByText("识别中…") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("有提示文案时按 tone 渲染对应样式类", () => {
    renderPanel({
      autoDetectMessage: { text: "该 PDF 似乎是扫描件", tone: "error" },
    });
    const msg = screen.getByText(/扫描件/);
    expect(msg.className).toMatch(/auto-detect-error/);
  });
});
