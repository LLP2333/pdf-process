import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TopBar from "../src/components/TopBar";

function renderTopBar(overrides: Partial<Parameters<typeof TopBar>[0]> = {}) {
  const props = {
    hasDocs: true,
    canUndo: false,
    canRedo: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    autoTrim: true,
    onAutoTrimChange: vi.fn(),
    bottomSpace: 5,
    onBottomSpaceChange: vi.fn(),
    footerText: "",
    onFooterTextChange: vi.fn(),
    footerSize: 8,
    onFooterSizeChange: vi.fn(),
    includedCount: 3,
    exportBusy: null,
    onExport: vi.fn(),
    ...overrides,
  };
  render(<TopBar {...props} />);
  return props;
}

describe("TopBar", () => {
  it("有题目时导出按钮可用并回调对应格式", () => {
    const props = renderTopBar();
    fireEvent.click(screen.getByRole("button", { name: /导出 PDF \(3\)/ }));
    expect(props.onExport).toHaveBeenCalledWith("pdf");
    fireEvent.click(screen.getByRole("button", { name: "PPTX" }));
    expect(props.onExport).toHaveBeenCalledWith("pptx");
  });

  it("没有可导出题目时导出按钮禁用;撤销/重做按钮按可用性禁用", () => {
    const props = renderTopBar({ includedCount: 0, canUndo: true });
    expect(screen.getByRole("button", { name: /导出 PDF/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "PPTX" })).toBeDisabled();

    const undoBtn = screen.getByRole("button", { name: "撤销" });
    const redoBtn = screen.getByRole("button", { name: "重做" });
    expect(undoBtn).toBeEnabled();
    expect(redoBtn).toBeDisabled();
    fireEvent.click(undoBtn);
    expect(props.onUndo).toHaveBeenCalled();
  });

  it("导出设置弹层:修改页脚署名与题目留白会触发回调", () => {
    const props = renderTopBar();
    fireEvent.click(screen.getByRole("button", { name: "导出设置" }));

    const footerInput = screen.getByPlaceholderText(/张老师/);
    fireEvent.change(footerInput, { target: { value: "整理:李老师" } });
    expect(props.onFooterTextChange).toHaveBeenCalledWith("整理:李老师");

    const spaceSlider = screen.getByRole("slider", { name: "题目留白" });
    expect(spaceSlider).toHaveAttribute("max", "80");
    fireEvent.change(spaceSlider, { target: { value: "40" } });
    expect(props.onBottomSpaceChange).toHaveBeenCalledWith(40);

    fireEvent.click(screen.getByRole("checkbox"));
    expect(props.onAutoTrimChange).toHaveBeenCalledWith(false);
  });

  it("署名字号:未填署名时禁用;填了以后可改且被夹到 6-24", () => {
    // 反例:footerText 为空 → 字号输入框禁用
    renderTopBar();
    fireEvent.click(screen.getByRole("button", { name: "导出设置" }));
    expect(screen.getByRole("spinbutton", { name: "署名字号" })).toBeDisabled();
  });

  it("署名字号:有署名时修改触发回调并夹取上限", () => {
    const props = renderTopBar({ footerText: "整理:张老师", footerSize: 8 });
    fireEvent.click(screen.getByRole("button", { name: "导出设置" }));

    const sizeInput = screen.getByRole("spinbutton", { name: "署名字号" });
    expect(sizeInput).toBeEnabled();
    fireEvent.change(sizeInput, { target: { value: "14" } });
    expect(props.onFooterSizeChange).toHaveBeenCalledWith(14);
    fireEvent.change(sizeInput, { target: { value: "99" } });
    expect(props.onFooterSizeChange).toHaveBeenCalledWith(24);
  });

  it("未上传文档时不渲染历史与导出区", () => {
    renderTopBar({ hasDocs: false });
    expect(screen.queryByRole("button", { name: /导出 PDF/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "撤销" })).toBeNull();
  });
});
