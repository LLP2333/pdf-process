import "@testing-library/jest-dom/vitest";

// jsdom 没实现 Object URL 一族;组件里预览图的建/销毁都依赖它,这里补最小桩
if (typeof URL.createObjectURL !== "function") {
  let objectUrlSeq = 0;
  URL.createObjectURL = () => `blob:jsdom-${++objectUrlSeq}`;
}
if (typeof URL.revokeObjectURL !== "function") {
  URL.revokeObjectURL = () => undefined;
}
