// src/components/panel/PagePanel.tsx
import { useState, useRef, useEffect } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useThumbnails } from '../../hooks/useThumbnails'
import { t } from '../../i18n'

export interface PagePanelProps {
  pdfDoc: PDFDocumentProxy
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
}: PagePanelProps) {
  const [selected, setSelected]         = useState<Set<number>>(new Set())
  const [lastSelected, setLastSelected] = useState<number | null>(null)
  const [dragSource, setDragSource]     = useState<number | null>(null)
  const [dragOver, setDragOver]         = useState<number | null>(null)
  const [addMenuOpen, setAddMenuOpen]   = useState(false)
  const addMenuRef   = useRef<HTMLDivElement>(null)
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
    <div className="relative flex flex-col w-44 md:w-40 shrink-0 h-full bg-gray-900 border-r border-gray-700 overflow-hidden select-none">
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
      <div className="flex-1 overflow-y-auto py-2 px-1.5 flex flex-col gap-2">
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

      {/* 조작 중 오버레이 */}
      {isOperating && (
        <div className="absolute inset-0 bg-gray-900/70 flex items-center justify-center z-10">
          <span className="text-xs text-gray-300">{t('panel.processing')}</span>
        </div>
      )}
    </div>
  )
}
