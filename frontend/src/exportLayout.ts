/**
 * 导出排版的前端镜像:与后端 `pdf_service.build_pdf` / `ppt_service.build_pptx` 同一套算法,
 * 供题目面板做"所见即所得"的页面预览,拖动「题目留白」滑块无需请求后端。
 *
 * 算法:先算出题区恰好铺满可用区(四周 PAGE_MARGIN_PT)的等比缩放,
 * 再乘 `1 - space/100`,题区贴左上角。改动这里时务必同步后端。
 */

export type PageFormat = "pdf" | "pptx";

/** 页面尺寸(pt):PDF 为横版 A4,PPTX 为 13.333in × 7.5in(16:9)。 */
export const PAGE_SIZES: Record<PageFormat, { width: number; height: number }> = {
  pdf: { width: 842, height: 595 },
  pptx: { width: 13.333 * 72, height: 7.5 * 72 },
};

/** 与后端 `pdf_service.PAGE_MARGIN_PT` 一致。 */
export const PAGE_MARGIN_PT = 28;

/** 页脚署名左边距(pt),与后端 `FOOTER_MARGIN_X` / PPTX 0.25in 一致。 */
export const FOOTER_LEFT_PT = 18;

export interface PageBox {
  /** 以下均为占页面宽 / 高的百分比(0-100),可直接用于绝对定位。 */
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * 计算题区(宽 contentW、高 contentH,任意同比例单位)在导出页上的位置。
 * 内容尺寸非法时返回 null。
 */
export function layoutOnPage(
  contentW: number,
  contentH: number,
  format: PageFormat,
  space: number,
): PageBox | null {
  if (!(contentW > 0) || !(contentH > 0)) return null;
  const { width: pw, height: ph } = PAGE_SIZES[format];
  const availW = pw - 2 * PAGE_MARGIN_PT;
  const availH = ph - 2 * PAGE_MARGIN_PT;
  const shrink = 1 - Math.min(80, Math.max(0, space)) / 100;
  const scale = Math.min(availW / contentW, availH / contentH) * shrink;
  return {
    left: (PAGE_MARGIN_PT / pw) * 100,
    top: (PAGE_MARGIN_PT / ph) * 100,
    width: ((contentW * scale) / pw) * 100,
    height: ((contentH * scale) / ph) * 100,
  };
}
