// The `/vitest` entry, not the bare one. jest-dom 7 split them: the bare entry
// now augments Jest only (`/// <reference path="jest.d.ts" />`), so with Vitest
// the matchers still ran but `toBeInTheDocument` and friends were untyped.
import '@testing-library/jest-dom/vitest'

// jsdom implements no layout, so it ships no scrollIntoView. Code that brings a
// match or a page into view is otherwise perfectly testable, so stub it here
// rather than making the app guard a method every real browser has.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {}
}
