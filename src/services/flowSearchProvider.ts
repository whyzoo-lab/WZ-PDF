/**
 * A find engine a reflowing view can put in place of the DOM search.
 *
 * `useFlowSearch` finds by walking the marked element's text, which only works
 * when the whole document is in the DOM. A large spreadsheet is drawn a window
 * of rows at a time (SheetView), so walking the DOM would find only the rows on
 * screen — on a 215,897-row list, find would miss nearly everything. Such a
 * view registers one of these while it is mounted; it searches its own data
 * and brings each match on screen when asked.
 */
export interface FlowSearchProvider {
  /**
   * Search for `needle` (already lower-cased); returns how many matches — or a
   * promise of it, for a search that hands the thread back while it works
   * (services/sheetSearch.ts). A newer call replaces an older one.
   */
  find(needle: string): number | Promise<number>
  /** The find bar has opened: get ready (a large sheet starts its index). */
  prepare?(): void
  /** Bring match `index` on screen and highlight it. */
  reveal(index: number): void
  /** Forget the search and remove its highlights. */
  clear(): void
}

let provider: FlowSearchProvider | null = null

export function setFlowSearchProvider(next: FlowSearchProvider | null): void {
  provider = next
}

export function getFlowSearchProvider(): FlowSearchProvider | null {
  return provider
}
