import '@testing-library/jest-dom'

// jsdom implements no layout, so it ships no scrollIntoView. Code that brings a
// match or a page into view is otherwise perfectly testable, so stub it here
// rather than making the app guard a method every real browser has.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {}
}
