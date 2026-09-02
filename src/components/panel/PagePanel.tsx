// src/components/panel/PagePanel.tsx
import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { ViewerDoc } from '../../types/viewerDoc'
import { useThumbnails } from '../../hooks/useThumbnails'
import { t } from '../../i18n'

export interface PagePanelProps {
  pdfDoc: ViewerDoc
  numPages: number
  currentPage: number
  isOperating: boolean
  /** When true, hides edit toolbar, disables drag-and-drop and Delete-key shortcut. */
  readOnly?: boolean
  /** Called when the mobile drawer's close button is tapped (no-op on desktop). */
  onClose?: () => void
  onScrollToPage: (page: number) => void
  onDeletePages: (pageNums: number[]) => void
  onInsertBlankPage: (afterPage: number) => void
  onInsertFromPdf: (afterPage: number, srcBytes: ArrayBuffer) => void
  onReorderPages: (newOrder: number[]) => void
  /**
   * Save the selected pages as a new PDF. Absent when the open document is not
   * a PDF — extraction goes through pdf-lib, which has nothing to say about a
   * HWP or an image, and a menu entry that always failed would be worse than
   * no menu entry.
   */
  onSavePages?: (pageNums: number[]) => void
}

export function PagePanel({
  pdfDoc,
  numPages,
  currentPage,
  isOperating,
  readOnly = false,
  onClose,
  onScrollToPage,
  onDeletePages,
  onInsertBlankPage,
  onInsertFromPdf,
  onReorderPages,
  onSavePages,
}: PagePanelProps) {
  const [selected, setSelected]         = useState<Set<number>>(new Set())
  const [lastSelected, setLastSelected] = useState<number | null>(null)
  const [dragSource, setDragSource]     = useState<number | null>(null)
  const [dragOver, setDragOver]         = useState<number | null>(null)
  const [addMenuOpen, setAddMenuOpen]   = useState(false)
  /** Where the right-click landed, in viewport coordinates. */
  const [contextAt, setContextAt]       = useState<{ x: number; y: number } | null>(null)
  const addMenuRef   = useRef<HTMLDivElement>(null)
  const listRef      = useRef<HTMLDivElement>(null)
  const thumbnails   = useThumbnails(pdfDoc, numPages)

  // 패널 바깥 클릭 시 추가 메뉴 닫기
  useEffect(() => {
    if (!addMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setAddMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [addMenuOpen])

  // ── 선택 ────────────────────────────────────────────────────────────────────
  const handleClick = (pageNum: number, e: React.MouseEvent) => {
    if (e.shiftKey && lastSelected !== null) {
      const min = Math.min(lastSelected, pageNum)
      const max = Math.max(lastSelected, pageNum)
      setSelected(prev => {
        const next = new Set(prev)
        for (let i = min; i <= max; i++) next.add(i)
        return next
      })
    } else if (e.ctrlKey || e.metaKey) {
      setSelected(prev => {
        const next = new Set(prev)
        if (next.has(pageNum)) next.delete(pageNum)
        else next.add(pageNum)
        return next
      })
      setLastSelected(pageNum)
    } else {
      setSelected(new Set([pageNum]))
      setLastSelected(pageNum)
      onScrollToPage(pageNum)
    }
  }

  // ── 우클릭 ──────────────────────────────────────────────────────────────────
  // 선택 밖의 페이지를 우클릭하면 그 페이지만 선택한다. 파일 탐색기와 같은
  // 규칙으로, 선택해 둔 것을 지운 채 메뉴를 여는 사고를 막아 준다.
  // 읽기 전용에서도 연다. 선택 저장은 문서를 바꾸지 않고 복사본을 하나 만들 뿐이라
  // 편집 권한과 상관이 없고, 편집 모드로 들어갔다 나오게 만들 이유도 없다.
  const handleContextMenu = (pageNum: number, e: React.MouseEvent) => {
    if (!onSavePages) return
    e.preventDefault()
    if (!selected.has(pageNum)) {
      setSelected(new Set([pageNum]))
      setLastSelected(pageNum)
    }
    setContextAt({ x: e.clientX, y: e.clientY })
  }

  const closeContextMenu = () => setContextAt(null)

  const handleSaveSelected = () => {
    closeContextMenu()
    if (selected.size === 0) return
    // 정렬해서 넘긴다 — 클릭한 순서가 아니라 문서 순서가 저장 순서여야 한다.
    onSavePages?.([...selected].sort((a, b) => a - b))
  }

  // 메뉴는 화면 어디를 눌러도, ESC로도, 섬네일 목록이 스크롤되어도 닫힌다.
  // 메뉴는 커서 위치에 고정돼 있어서, 목록이 움직이면 가리키던 섬네일과
  // 어긋나기 때문이다.
  //
  // 스크롤은 목록에만 건다. window에 capture로 걸면 *다른* 스크롤에도 닫힌다 —
  // 페이지를 클릭하면 본문이 그 페이지로 스크롤되는데, 그 스크롤이 우클릭 직후에
  // 도착해 메뉴를 곧바로 닫아 버렸다.
  useEffect(() => {
    if (!contextAt) return
    const close = () => setContextAt(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    const list = listRef.current
    window.addEventListener('mousedown', close)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    list?.addEventListener('scroll', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
      list?.removeEventListener('scroll', close)
    }
  }, [contextAt])

  // ── 삭제 ────────────────────────────────────────────────────────────────────
  const handleDelete = () => {
    if (readOnly) return
    if (selected.size === 0 || numPages - selected.size < 1) return
    if (!confirm(t('panel.confirmDelete', { n: selected.size }))) return
    onDeletePages([...selected].sort((a, b) => a - b))
    setSelected(new Set())
    setLastSelected(null)
  }

  // ── Delete 키 단축키 ─────────────────────────────────────────────────────────
  // 패널 내에서 페이지를 선택한 상태에서 Delete 키를 누르면 삭제.
  // 입력 요소(input/textarea/contenteditable) 포커스 시에는 무시.
  useEffect(() => {
    if (readOnly) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete') return
      if (selected.size === 0) return
      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return
      }
      e.preventDefault()
      handleDelete()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, selected, numPages])

  // ── 삽입 위치 ────────────────────────────────────────────────────────────────
  const insertAfterPage = selected.size > 0
    ? Math.max(...selected)
    : currentPage

  // ── 빈 페이지 삽입 ────────────────────────────────────────────────────────────
  const handleInsertBlank = () => {
    onInsertBlankPage(insertAfterPage)
    setAddMenuOpen(false)
  }

  // ── 다른 PDF에서 삽입 ─────────────────────────────────────────────────────────
  const handlePdfFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    f.arrayBuffer()
      .then(bytes => onInsertFromPdf(insertAfterPage, bytes))
      .catch(err => alert(t('panel.readError', { error: err instanceof Error ? err.message : String(err) })))
    e.target.value = ''
    setAddMenuOpen(false)
  }

  // ── 드래그 앤 드롭 ────────────────────────────────────────────────────────────
  const handleDragStart = (e: React.DragEvent, pageNum: number) => {
    setDragSource(pageNum)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent, pageNum: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOver(pageNum)
  }

  const handleDrop = (e: React.DragEvent, target: number) => {
    e.preventDefault()
    if (dragSource === null || dragSource === target) {
      setDragSource(null)
      setDragOver(null)
      return
    }
    const order = Array.from({ length: numPages }, (_, i) => i + 1)
    order.splice(order.indexOf(dragSource), 1)
    order.splice(order.indexOf(target), 0, dragSource)
    onReorderPages(order)
    setDragSource(null)
    setDragOver(null)
    setSelected(new Set())
  }

  const handleDragEnd = () => {
    setDragSource(null)
    setDragOver(null)
  }

  const canDelete = selected.size > 0 && numPages - selected.size >= 1

  return (
    // A navigation landmark, because that is what it is: the way to get to a
    // page. A screen reader can jump straight to it instead of tabbing past the
    // whole toolbar to find out what this column is.
    <nav
      aria-label={t('a11y.pageList')}
      className="relative flex flex-col w-44 md:w-40 shrink-0 h-full bg-gray-900 border-r border-gray-700 overflow-hidden select-none"
    >
      {/* 헤더 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700 shrink-0">
        <span className="text-xs font-semibold text-gray-300">Pages</span>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-gray-500">{numPages}p</span>
          {/* Close button — only on mobile (md:hidden). Desktop uses ActionBar's Pages toggle. */}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="md:hidden w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:bg-gray-700 hover:text-white"
              aria-label={t('panel.close')}
            >
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* 도구 모음 (편집 모드 전용) */}
      {!readOnly && (
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-gray-700 shrink-0">
        {/* 추가 메뉴 */}
        <div ref={addMenuRef} className="relative">
          <button
            disabled={isOperating}
            onClick={() => setAddMenuOpen(v => !v)}
            className="flex items-center gap-0.5 px-2 py-1 text-[11px] bg-gray-700 hover:bg-gray-600 text-gray-200 rounded disabled:opacity-50 transition-colors"
            title={t('panel.addTitle')}
          >
            {t('panel.add')}
          </button>
          {addMenuOpen && (
            <div className="absolute left-0 top-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl py-1 z-50 min-w-[150px]">
              <button
                onClick={handleInsertBlank}
                className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-700 transition-colors"
              >
                {t('panel.insertBlank')}
              </button>
              <label className="w-full flex px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-700 cursor-pointer transition-colors">
                {t('panel.insertFromPdf')}
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  className="hidden"
                  onChange={handlePdfFileChange}
                />
              </label>
            </div>
          )}
        </div>

        {/* 삭제 버튼 */}
        <button
          disabled={!canDelete || isOperating}
          onClick={handleDelete}
          className="flex items-center gap-0.5 px-2 py-1 text-[11px] bg-red-800 hover:bg-red-700 text-white rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title={canDelete ? t('panel.deleteN', { n: selected.size }) : t('panel.selectFirst')}
        >
          🗑{selected.size > 0 ? ` (${selected.size})` : ''}
        </button>
      </div>
      )}

      {/* 섬네일 목록 */}
      <div ref={listRef} className="flex-1 overflow-y-auto py-2 px-1.5 flex flex-col gap-2">
        {Array.from({ length: numPages }, (_, i) => i + 1).map(pageNum => {
          const isSelected   = selected.has(pageNum)
          const isCurrent    = currentPage === pageNum
          const isDragTarget = dragOver === pageNum && dragSource !== pageNum

          return (
            <div
              key={pageNum}
              draggable={!readOnly}
              onDragStart={readOnly ? undefined : e => handleDragStart(e, pageNum)}
              onDragOver={readOnly ? undefined : e => handleDragOver(e, pageNum)}
              onDrop={readOnly ? undefined : e => handleDrop(e, pageNum)}
              onDragEnd={readOnly ? undefined : handleDragEnd}
              onClick={e => handleClick(pageNum, e)}
              onContextMenu={e => handleContextMenu(pageNum, e)}
              className={[
                'flex flex-col items-center gap-1 p-1 rounded cursor-pointer transition-all',
                isSelected  ? 'bg-blue-600/30 ring-2 ring-blue-500' : 'hover:bg-gray-800',
                isCurrent && !isSelected ? 'ring-1 ring-gray-500' : '',
                isDragTarget ? 'border-t-2 border-blue-400' : '',
              ].filter(Boolean).join(' ')}
            >
              {thumbnails[pageNum - 1] ? (
                <img
                  src={thumbnails[pageNum - 1]!}
                  alt={`Page ${pageNum}`}
                  className="w-full rounded shadow-sm pointer-events-none"
                  draggable={false}
                />
              ) : (
                <div className="w-full aspect-[3/4] bg-gray-700 rounded animate-pulse" />
              )}
              <span className={`text-[10px] tabular-nums ${isCurrent ? 'text-blue-400 font-medium' : 'text-gray-500'}`}>
                {pageNum}
              </span>
            </div>
          )
        })}
      </div>

      {/* 우클릭 메뉴 — 패널은 overflow-hidden이고 목록은 스크롤 영역이라,
          안에 그리면 잘린다. body로 띄우고 커서 위치에 고정한다. */}
      {contextAt && createPortal(
        <div
          role="menu"
          style={{ position: 'fixed', top: contextAt.y, left: contextAt.x, zIndex: 9999 }}
          className="min-w-[150px] rounded-lg border border-gray-600 bg-gray-800 py-1 shadow-xl"
          onMouseDown={e => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={handleSaveSelected}
            disabled={isOperating}
            className="w-full px-3 py-1.5 text-left text-xs text-gray-200 hover:bg-gray-700
                       disabled:opacity-40 transition-colors"
          >
            {t('panel.saveSelected', { n: selected.size })}
          </button>
        </div>,
        document.body,
      )}

      {/* 조작 중 오버레이 */}
      {isOperating && (
        <div className="absolute inset-0 bg-gray-900/70 flex items-center justify-center z-10">
          <span className="text-xs text-gray-300">{t('panel.processing')}</span>
        </div>
      )}
    </nav>
  )
}
