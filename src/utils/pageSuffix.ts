/**
 * The `_p3` / `_p3-7` / `_5p` tail on a saved page selection.
 *
 * A range is only written as one when the pages really are consecutive.
 * Naming a scattered selection `_p3-9` would describe a file that does not
 * exist — seven pages, when four were saved — which is the kind of small lie
 * that costs someone an hour later.
 */
export function pageSuffix(pageNums: readonly number[]): string {
  const pages = [...new Set(pageNums)].sort((a, b) => a - b)
  if (pages.length === 0) return ''
  if (pages.length === 1) return `_p${pages[0]}`
  const consecutive = pages[pages.length - 1] - pages[0] === pages.length - 1
  return consecutive ? `_p${pages[0]}-${pages[pages.length - 1]}` : `_${pages.length}p`
}
