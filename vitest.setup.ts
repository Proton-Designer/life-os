import "@testing-library/jest-dom/vitest";

// jsdom implements neither of these, and Radix UI's interactive primitives
// (Select, and others built on the same pointer-events primitive) call them
// unconditionally — without these no-op stubs, opening a Select in jsdom
// throws "target.hasPointerCapture is not a function" instead of the actual
// failure a test might have. Global, not per-test-file, since any future
// consumer of Select/Popover/etc. would hit the exact same jsdom gap.
if (typeof Element !== "undefined") {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
}
