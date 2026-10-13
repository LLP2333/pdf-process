import { describe, it, expect } from "vitest";
import { PAGE_MARGIN_PT, PAGE_SIZES, layoutOnPage } from "../src/exportLayout";

describe("layoutOnPage", () => {
  it("留白 0%:宽题铺满可用宽度,贴左上角", () => {
    const box = layoutOnPage(1000, 100, "pdf", 0)!;
    const { width: pw, height: ph } = PAGE_SIZES.pdf;
    expect(box.left).toBeCloseTo((PAGE_MARGIN_PT / pw) * 100);
    expect(box.top).toBeCloseTo((PAGE_MARGIN_PT / ph) * 100);
    expect(box.width).toBeCloseTo(((pw - 2 * PAGE_MARGIN_PT) / pw) * 100);
  });

  it("留白 50%:高题缩到可用高度的一半", () => {
    const box = layoutOnPage(100, 1000, "pptx", 50)!;
    const { height: ph } = PAGE_SIZES.pptx;
    expect(box.height).toBeCloseTo((((ph - 2 * PAGE_MARGIN_PT) * 0.5) / ph) * 100);
  });

  it("留白越大题区越小,且保持宽高比", () => {
    const a = layoutOnPage(400, 300, "pdf", 20)!;
    const b = layoutOnPage(400, 300, "pdf", 60)!;
    expect(b.width).toBeLessThan(a.width);
    const { width: pw, height: ph } = PAGE_SIZES.pdf;
    expect((b.width * pw) / (b.height * ph)).toBeCloseTo(400 / 300);
  });

  it("内容尺寸非法时返回 null", () => {
    expect(layoutOnPage(0, 100, "pdf", 20)).toBeNull();
  });
});
