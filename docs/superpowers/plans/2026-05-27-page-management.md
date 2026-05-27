# Page Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Editor 모드에서 왼쪽 섬네일 패널을 통해 PDF 페이지를 삭제·추가·순서변경·병합하고, 풀스크린 모드에서 터치패드 수평 스와이프로 페이지를 넘긴다.

**Architecture:** `pdfPageService.ts`(pdf-lib 기반 순수 함수)가 새 `ArrayBuffer`와 `pageMapping`을 반환하면, `App.tsx`가 `setFile(new File([newBytes], …))`로 pdfDoc을 재로드하고 `remapAnnotations(pageMapping)`으로 어노테이션을 갱신한다. `PagePanel`은 UI와 선택 상태만 담당하며 `useThumbnails` 훅에서 렌더링한 섬네일 data URL을 표시한다.

**Tech Stack:** pdf-lib (이미 설치됨), pdfjs-dist (이미 설치됨), React, Tailwind CSS, Vitest + @testing-library/react

---

## File Map

| 파일 | 역할 |
|---|---|
| `src/services/pdfPageService.ts` ← **신규** | 페이지 조작 순수 함수 4개 |
| `src/services/__tests__/pdfPageService.test.ts` ← **신규** | 서비스 단위 테스트 |
| `src/hooks/useThumbnails.ts` ← **신규** | pdfjs로 섬네일 data URL 렌더링 |
| `src/components/panel/PagePanel.tsx` ← **신규** | 왼쪽 섬네일 패널 UI |
| `src/hooks/useAnnotations.ts` ← **수정** | `remapAnnotations` 콜백 추가 |
| `src/hooks/__tests__/useAnnotations.test.ts` ← **수정** | remapAnnotations 테스트 추가 |
| `src/components/toolbar/ActionBar.tsx` ← **수정** | Pages 토글 버튼 + 관련 props |
| `src/App.tsx` ← **수정** | `isPanelOpen`·`isPageOperating` 상태, 페이지 조작 핸들러, 레이아웃 |
| `src/components/viewer/FullscreenView.tsx` ← **수정** | 수평 스와이프 네비게이션 |

---

## Task 1: pdfPageService — 페이지 조작 순수 함수 (TDD)

**Files:**
- Create: `src/services/__tests__/pdfPageService.test.ts`
- Create: `src/services/pdfPageService.ts`

- [ ] **Step 1: 테스트 파일 작성**

```typescript
// src/services/__tests__/pdfPageService.test.ts
import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { deletePages, insertBlankPage, insertPagesFromPdf, reorderPages } from '../pdfPageService'

/** 지정한 페이지 수만큼 빈 페이지를 가진 테스트용 PDF를 만든다. */
async function makeTestPdf(pageCount: number): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([612, 792])  // US Letter
  }
  const bytes = await doc.save()
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function pageCount(bytes: ArrayBuffer): Promise<number> {
  const doc = await PDFDocument.load(bytes)
  return doc.getPageCount()
}

describe('deletePages', () => {
  it('단일 페이지 삭제 후 페이지 수가 줄고 매핑이 정확하다', async () => {
    const bytes = await makeTestPdf(3)
    const { newBytes, pageMapping } = await deletePages(bytes, [2])
    expect(await pageCount(newBytes)).toBe(2)
    expect(pageMapping.get(1)).toBe(1)
    expect(pageMapping.has(2)).toBe(false)   // 삭제됨
    expect(pageMapping.get(3)).toBe(2)
  })

  it('여러 페이지 삭제', async () => {
    const bytes = await makeTestPdf(5)
    const { newBytes, pageMapping } = await deletePages(bytes, [2, 4])
    expect(await pageCount(newBytes)).toBe(3)
    expect(pageMapping.get(1)).toBe(1)
    expect(pageMapping.has(2)).toBe(false)
    expect(pageMapping.get(3)).toBe(2)
    expect(pageMapping.has(4)).toBe(false)
    expect(pageMapping.get(5)).toBe(3)
  })
})

describe('insertBlankPage', () => {
  it('지정 페이지 뒤에 빈 페이지 삽입', async () => {
    const bytes = await makeTestPdf(3)
    const { newBytes, pageMapping } = await insertBlankPage(bytes, 1)
    expect(await pageCount(newBytes)).toBe(4)
    expect(pageMapping.get(1)).toBe(1)
    expect(pageMapping.get(2)).toBe(3)
    expect(pageMapping.get(3)).toBe(4)
  })

  it('afterPage=0 이면 맨 앞에 삽입', async () => {
    const bytes = await makeTestPdf(3)
    const { newBytes, pageMapping } = await insertBlankPage(bytes, 0)
    expect(await pageCount(newBytes)).toBe(4)
    expect(pageMapping.get(1)).toBe(2)
    expect(pageMapping.get(2)).toBe(3)
    expect(pageMapping.get(3)).toBe(4)
  })

  it('afterPage = 마지막 페이지면 맨 뒤에 삽입', async () => {
    const bytes = await makeTestPdf(3)
    const { newBytes, pageMapping } = await insertBlankPage(bytes, 3)
    expect(await pageCount(newBytes)).toBe(4)
    expect(pageMapping.get(1)).toBe(1)
    expect(pageMapping.get(2)).toBe(2)
    expect(pageMapping.get(3)).toBe(3)
    // 새 빈 페이지는 4번 — 기존 어노테이션 없으므로 매핑 불필요
  })
})

describe('insertPagesFromPdf', () => {
  it('다른 PDF의 모든 페이지를 지정 위치 뒤에 삽입', async () => {
    const dest = await makeTestPdf(3)
    const src  = await makeTestPdf(2)
    const { newBytes, pageMapping } = await insertPagesFromPdf(dest, src, 1)
    expect(await pageCount(newBytes)).toBe(5)
    expect(pageMapping.get(1)).toBe(1)
    // dest 2번 → 새 4번 (src 2페이지가 2,3번에 들어감)
    expect(pageMapping.get(2)).toBe(4)
    expect(pageMapping.get(3)).toBe(5)
  })
})

describe('reorderPages', () => {
  it('newOrder 배열 순서대로 페이지를 재배열하고 매핑을 반환한다', async () => {
    const bytes = await makeTestPdf(3)
    const { newBytes, pageMapping } = await reorderPages(bytes, [3, 1, 2])
    expect(await pageCount(newBytes)).toBe(3)
    expect(pageMapping.get(3)).toBe(1)
    expect(pageMapping.get(1)).toBe(2)
    expect(pageMapping.get(2)).toBe(3)
  })

  it('역순 재배열', async () => {
    const bytes = await makeTestPdf(4)
    const { newBytes, pageMapping } = await reorderPages(bytes, [4, 3, 2, 1])
    expect(await pageCount(newBytes)).toBe(4)
    expect(pageMapping.get(4)).toBe(1)
    expect(pageMapping.get(1)).toBe(4)
  })
})
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```
npx vitest run src/services/__tests__/pdfPageService.test.ts
```
Expected: 모든 테스트 FAIL (모듈 없음)

- [ ] **Step 3: `pdfPageService.ts` 구현**

```typescript
// src/services/pdfPageService.ts
import { PDFDocument } from 'pdf-lib'

export type PageOpResult = {
  newBytes: ArrayBuffer
  pageMapping: Map<number, number>  // 키: 기존 페이지 번호(1-based), 값: 새 페이지 번호
}

/** Uint8Array → ArrayBuffer (byteOffset이 0이 아닌 경우도 안전하게 처리) */
function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
}

/**
 * 지정한 페이지들을 삭제한다.
 * @param pageNums 삭제할 페이지 번호 배열 (1-based)
 */
export async function deletePages(
  bytes: ArrayBuffer,
  pageNums: number[],
): Promise<PageOpResult> {
  const srcDoc = await PDFDocument.load(bytes)
  const total = srcDoc.getPageCount()
  const deleteSet = new Set(pageNums)

  const newDoc = await PDFDocument.create()
  const pageMapping = new Map<number, number>()
  let newPageNum = 1

  for (let i = 1; i <= total; i++) {
    if (!deleteSet.has(i)) {
      const [p] = await newDoc.copyPages(srcDoc, [i - 1])
      newDoc.addPage(p)
      pageMapping.set(i, newPageNum++)
    }
  }

  return { newBytes: toArrayBuffer(await newDoc.save()), pageMapping }
}

/**
 * 지정 페이지 뒤에 빈 페이지를 삽입한다.
 * @param afterPage 삽입 위치 (0이면 맨 앞, 1-based)
 */
export async function insertBlankPage(
  bytes: ArrayBuffer,
  afterPage: number,
): Promise<PageOpResult> {
  const srcDoc = await PDFDocument.load(bytes)
  const total = srcDoc.getPageCount()

  // 빈 페이지 크기: afterPage > 0이면 해당 페이지 기준, 0이면 1번 페이지 기준
  const refIdx = afterPage > 0 ? afterPage - 1 : 0
  const { width, height } = srcDoc.getPage(refIdx).getSize()

  const newDoc = await PDFDocument.create()
  const pageMapping = new Map<number, number>()

  // 삽입 위치 앞쪽 페이지 복사
  for (let i = 1; i <= afterPage; i++) {
    const [p] = await newDoc.copyPages(srcDoc, [i - 1])
    newDoc.addPage(p)
    pageMapping.set(i, i)
  }

  // 빈 페이지 (새 페이지, 기존 어노테이션 없으므로 매핑에 추가하지 않음)
  newDoc.addPage([width, height])

  // 삽입 위치 뒤쪽 페이지 복사 (+1 오프셋)
  for (let i = afterPage + 1; i <= total; i++) {
    const [p] = await newDoc.copyPages(srcDoc, [i - 1])
    newDoc.addPage(p)
    pageMapping.set(i, i + 1)
  }

  return { newBytes: toArrayBuffer(await newDoc.save()), pageMapping }
}

/**
 * 지정 페이지 뒤에 다른 PDF의 모든 페이지를 삽입한다.
 * @param afterPage 삽입 위치 (1-based, 0이면 맨 앞)
 */
export async function insertPagesFromPdf(
  bytes: ArrayBuffer,
  srcBytes: ArrayBuffer,
  afterPage: number,
): Promise<PageOpResult> {
  const destDoc = await PDFDocument.load(bytes)
  const srcDoc  = await PDFDocument.load(srcBytes)
  const destTotal = destDoc.getPageCount()
  const srcTotal  = srcDoc.getPageCount()

  const newDoc = await PDFDocument.create()
  const pageMapping = new Map<number, number>()

  // 삽입 위치 앞쪽 dest 페이지
  for (let i = 1; i <= afterPage; i++) {
    const [p] = await newDoc.copyPages(destDoc, [i - 1])
    newDoc.addPage(p)
    pageMapping.set(i, i)
  }

  // src 페이지 전체 (새 페이지, 매핑 불필요)
  for (let i = 0; i < srcTotal; i++) {
    const [p] = await newDoc.copyPages(srcDoc, [i])
    newDoc.addPage(p)
  }

  // 삽입 위치 뒤쪽 dest 페이지 (+srcTotal 오프셋)
  for (let i = afterPage + 1; i <= destTotal; i++) {
    const [p] = await newDoc.copyPages(destDoc, [i - 1])
    newDoc.addPage(p)
    pageMapping.set(i, i + srcTotal)
  }

  return { newBytes: toArrayBuffer(await newDoc.save()), pageMapping }
}

/**
 * 페이지 순서를 재배열한다.
 * @param newOrder 새 순서 배열. newOrder[i] = 새 i+1번 위치에 놓일 원래 페이지 번호 (1-based)
 *                 예: [3, 1, 2] → 기존 3번이 1번, 1번이 2번, 2번이 3번이 됨
 */
export async function reorderPages(
  bytes: ArrayBuffer,
  newOrder: number[],
): Promise<PageOpResult> {
  const srcDoc = await PDFDocument.load(bytes)
  const newDoc = await PDFDocument.create()
  const pageMapping = new Map<number, number>()

  for (let newIdx = 0; newIdx < newOrder.length; newIdx++) {
    const oldPageNum = newOrder[newIdx]
    const [p] = await newDoc.copyPages(srcDoc, [oldPageNum - 1])
    newDoc.addPage(p)
    pageMapping.set(oldPageNum, newIdx + 1)
  }

  return { newBytes: toArrayBuffer(await newDoc.save()), pageMapping }
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```
npx vitest run src/services/__tests__/pdfPageService.test.ts
```
Expected: 모든 테스트 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/services/pdfPageService.ts src/services/__tests__/pdfPageService.test.ts
git commit -m "feat: add pdfPageService with delete/insert/reorder page operations"
```

---

## Task 2: useAnnotations — remapAnnotations 추가 (TDD)

**Files:**
- Modify: `src/hooks/__tests__/useAnnotations.test.ts`
- Modify: `src/hooks/useAnnotations.ts`

- [ ] **Step 1: 테스트 추가**

`src/hooks/__tests__/useAnnotations.test.ts` 파일 맨 아래 describe 블록 안에 다음을 추가 (기존 마지막 `it` 블록 바로 뒤):

```typescript
  it('remapAnnotations: 매핑된 페이지 번호로 어노테이션을 이동시킨다', () => {
    const { result } = renderHook(() => useAnnotations())
    // 1번, 2번, 3번 페이지에 각각 어노테이션 추가
    let id1!: string, id2!: string, id3!: string
    act(() => { id1 = result.current.addAnnotation(makeStamp(1)) })
    act(() => { id2 = result.current.addAnnotation(makeStamp(2)) })
    act(() => { id3 = result.current.addAnnotation(makeStamp(3)) })

    // 2번 페이지 삭제: {1→1, 3→2}
    const mapping = new Map([[1, 1], [3, 2]])
    act(() => { result.current.remapAnnotations(mapping) })

    const anns = result.current.annotations
    expect(anns).toHaveLength(2)
    expect(anns.find(a => a.id === id1)?.page).toBe(1)
    expect(anns.find(a => a.id === id2)).toBeUndefined()  // 삭제된 페이지
    expect(anns.find(a => a.id === id3)?.page).toBe(2)
    expect(result.current.selectedId).toBeNull()  // 선택 해제
  })

  it('remapAnnotations: allPages 워터마크는 매핑에 관계없이 유지된다', () => {
    const { result } = renderHook(() => useAnnotations())
    act(() => {
      result.current.addAnnotation({
        type: 'watermark',
        page: 1,
        x: 0, y: 0, width: 0, height: 0,
        rotation: 0,
        text: 'DRAFT',
        opacity: 0.5,
        fontSize: 48,
        color: '#888888',
        allPages: true,
      })
    })
    // 1번 페이지가 삭제되더라도 allPages 워터마크는 남아야 함
    const mapping = new Map<number, number>()  // 빈 매핑 (모든 페이지 삭제)
    act(() => { result.current.remapAnnotations(mapping) })
    expect(result.current.annotations).toHaveLength(1)
  })
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```
npx vitest run src/hooks/__tests__/useAnnotations.test.ts
```
Expected: 새로 추가한 테스트 2개 FAIL (remapAnnotations 없음)

- [ ] **Step 3: useAnnotations.ts에 remapAnnotations 추가**

`src/hooks/useAnnotations.ts`에서 `UseAnnotationsReturn` 인터페이스와 훅 구현에 각각 추가한다.

인터페이스에 추가:
```typescript
export interface UseAnnotationsReturn extends AnnotationState {
  addAnnotation: (annotation: OmitId<Annotation>) => string
  updateAnnotation: (id: string, updates: Partial<Annotation>) => void
  removeAnnotation: (id: string) => void
  selectAnnotation: (id: string | null) => void
  setActiveMode: (mode: ActiveMode) => void
  remapAnnotations: (mapping: Map<number, number>) => void  // ← 추가
}
```

훅 본문에 `setActiveMode` 뒤에 추가:
```typescript
  const remapAnnotations = useCallback((mapping: Map<number, number>) => {
    setState(prev => {
      const remapped: Annotation[] = []
      for (const ann of prev.annotations) {
        // allPages 워터마크는 특정 페이지에 종속되지 않으므로 항상 유지
        if (ann.type === 'watermark' && ann.allPages) {
          remapped.push(ann)
          continue
        }
        const newPage = mapping.get(ann.page)
        if (newPage !== undefined) {
          remapped.push({ ...ann, page: newPage } as Annotation)
        }
        // newPage가 undefined면 해당 페이지 삭제 → 어노테이션도 제거
      }
      return { ...prev, annotations: remapped, selectedId: null }
    })
  }, [])
```

return 문에 `remapAnnotations` 추가:
```typescript
  return { ...state, addAnnotation, updateAnnotation, removeAnnotation, selectAnnotation, setActiveMode, remapAnnotations }
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```
npx vitest run src/hooks/__tests__/useAnnotations.test.ts
```
Expected: 전체 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/hooks/useAnnotations.ts src/hooks/__tests__/useAnnotations.test.ts
git commit -m "feat: add remapAnnotations to useAnnotations for page operations"
```

---

## Task 3: useThumbnails — 섬네일 렌더링 훅

**Files:**
- Create: `src/hooks/useThumbnails.ts`

- [ ] **Step 1: 구현**

```typescript
// src/hooks/useThumbnails.ts
import { useState, useEffect } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { PDF_RENDER_SCALE } from '../utils/constants'

/** 썸네일 렌더링 배율 (1.5 × 0.2 = 0.3 → 약 90px 너비) */
const THUMBNAIL_SCALE = 0.2

/**
 * pdfjs로 각 페이지를 작은 data URL (JPEG)로 렌더링한다.
 * - 페이지를 순서대로 렌더링하며, 각 페이지가 완료될 때마다 배열을 업데이트.
 * - pdfDoc / numPages가 바뀌면 재렌더링.
 *
 * @returns (string | null)[] — null이면 아직 렌더링 중
 */
export function useThumbnails(
  pdfDoc: PDFDocumentProxy | null,
  numPages: number,
): (string | null)[] {
  const [dataUrls, setDataUrls] = useState<(string | null)[]>([])

  useEffect(() => {
    if (!pdfDoc || numPages === 0) {
      setDataUrls([])
      return
    }

    // null로 초기화 (로딩 스피너 표시용)
    setDataUrls(new Array(numPages).fill(null))

    let cancelled = false

    const renderSequentially = async () => {
      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        if (cancelled) break
        try {
          const page = await pdfDoc.getPage(pageNum)
          const viewport = page.getViewport({ scale: PDF_RENDER_SCALE * THUMBNAIL_SCALE })
          const canvas = document.createElement('canvas')
          canvas.width  = Math.round(viewport.width)
          canvas.height = Math.round(viewport.height)
          await page.render({ canvas, viewport }).promise
          if (cancelled) break
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
          setDataUrls(prev => {
            const next = [...prev]
            next[pageNum - 1] = dataUrl
            return next
          })
        } catch (err) {
          console.error(`[useThumbnails] page ${pageNum} 렌더링 실패:`, err)
        }
      }
    }

    renderSequentially()
    return () => { cancelled = true }
  }, [pdfDoc, numPages])

  return dataUrls
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/hooks/useThumbnails.ts
git commit -m "feat: add useThumbnails hook for sequential thumbnail rendering"
```

---

## Task 4: PagePanel — 왼쪽 섬네일 패널

**Files:**
- Create: `src/components/panel/PagePanel.tsx`

- [ ] **Step 1: 구현**

```typescript
// src/components/panel/PagePanel.tsx
import { useState, useRef, useEffect } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useThumbnails } from '../../hooks/useThumbnails'

export interface PagePanelProps {
  pdfDoc: PDFDocumentProxy
  numPages: number
  currentPage: number
  isOperating: boolean
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
  onScrollToPage,
  onDeletePages,
  onInsertBlankPage,
  onInsertFromPdf,
  onReorderPages,
}: PagePanelProps) {
  const [selected, setSelected]       = useState<Set<number>>(new Set())
  const [lastSelected, setLastSelected] = useState<number | null>(null)
  const [dragSource, setDragSource]   = useState<number | null>(null)
  const [dragOver, setDragOver]       = useState<number | null>(null)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const addMenuRef  = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const thumbnails  = useThumbnails(pdfDoc, numPages)

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
        next.has(pageNum) ? next.delete(pageNum) : next.add(pageNum)
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
    if (selected.size === 0 || numPages - selected.size < 1) return
    if (!confirm(`선택한 ${selected.size}개 페이지를 삭제할까요?`)) return
    onDeletePages([...selected])
    setSelected(new Set())
    setLastSelected(null)
  }

  // ── 삽입 위치 계산 ────────────────────────────────────────────────────────────
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
      .catch(err => alert(`PDF를 읽을 수 없습니다: ${err instanceof Error ? err.message : String(err)}`))
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
    // 현재 순서에서 dragSource를 빼고 target 위치에 삽입
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
    <div className="relative flex flex-col w-40 shrink-0 bg-gray-900 border-r border-gray-700 overflow-hidden select-none">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700 shrink-0">
        <span className="text-xs font-semibold text-gray-300">Pages</span>
        <span className="text-[10px] text-gray-500">{numPages}p</span>
      </div>

      {/* 도구 모음 */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-gray-700 shrink-0">
        {/* 추가 메뉴 */}
        <div ref={addMenuRef} className="relative">
          <button
            disabled={isOperating}
            onClick={() => setAddMenuOpen(v => !v)}
            className="flex items-center gap-0.5 px-2 py-1 text-[11px] bg-gray-700 hover:bg-gray-600 text-gray-200 rounded disabled:opacity-50 transition-colors"
            title="페이지 추가"
          >
            + 추가 ▾
          </button>
          {addMenuOpen && (
            <div className="absolute left-0 top-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl py-1 z-50 min-w-[150px]">
              <button
                onClick={handleInsertBlank}
                className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-700 transition-colors"
              >
                빈 페이지 삽입
              </button>
              <label className="w-full flex px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-700 cursor-pointer transition-colors">
                다른 PDF에서 삽입…
                <input
                  ref={fileInputRef}
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
          title={canDelete ? `${selected.size}개 페이지 삭제` : '페이지를 선택하세요'}
        >
          🗑{selected.size > 0 ? ` (${selected.size})` : ''}
        </button>
      </div>

      {/* 섬네일 목록 */}
      <div className="flex-1 overflow-y-auto py-2 px-1.5 flex flex-col gap-2">
        {Array.from({ length: numPages }, (_, i) => i + 1).map(pageNum => {
          const isSelected = selected.has(pageNum)
          const isCurrent  = currentPage === pageNum
          const isDragTarget = dragOver === pageNum && dragSource !== pageNum

          return (
            <div
              key={pageNum}
              draggable
              onDragStart={e => handleDragStart(e, pageNum)}
              onDragOver={e => handleDragOver(e, pageNum)}
              onDrop={e => handleDrop(e, pageNum)}
              onDragEnd={handleDragEnd}
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
          <span className="text-xs text-gray-300">처리 중…</span>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/components/panel/PagePanel.tsx
git commit -m "feat: add PagePanel component with thumbnail, multi-select, drag-and-drop"
```

---

## Task 5: ActionBar — Pages 토글 버튼 추가

**Files:**
- Modify: `src/components/toolbar/ActionBar.tsx`
- Modify: `src/components/toolbar/__tests__/ActionBar.test.tsx`

- [ ] **Step 1: ActionBarProps 인터페이스 수정**

`src/components/toolbar/ActionBar.tsx`의 `ActionBarProps` 인터페이스에 다음을 추가:

```typescript
export interface ActionBarProps {
  // ... 기존 props ...
  isPanelOpen: boolean            // ← 추가
  onTogglePanel: () => void       // ← 추가
  // ...
}
```

함수 매개변수에도 구조 분해 추가:
```typescript
export function ActionBar({
  hasPdf,
  appMode,
  viewMode,
  zoom,
  rotation,
  activeMode,
  selectedId,
  isExporting,
  numPages,
  currentPage,
  isPanelOpen,      // ← 추가
  onTogglePanel,    // ← 추가
  // ...나머지 기존 props...
}: ActionBarProps) {
```

- [ ] **Step 2: Pages 토글 버튼 JSX 추가**

Editor 모드 도구 영역 (`appMode === 'editor'` 블록) 안, `Select` 버튼 앞에 Pages 버튼과 구분선을 추가:

```tsx
{appMode === 'editor' && !isFullscreen && (
  <>
    <Sep />
    <div className="flex items-center gap-0.5 shrink-0">
      {/* Pages 패널 토글 — Editor 도구 영역 맨 앞 */}
      <button
        className={`flex items-center gap-1 px-2 py-1.5 text-xs rounded transition-all ${
          isPanelOpen
            ? 'bg-blue-600 text-white shadow-sm'
            : 'text-gray-300 hover:bg-gray-700 hover:text-white'
        }`}
        onClick={onTogglePanel}
        title="페이지 패널 열기/닫기"
      >
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-4 h-4">
          <rect x="2" y="3" width="7" height="14" rx="1"/>
          <path d="M13 6h4M13 10h4M13 14h4" strokeLinecap="round"/>
        </svg>
        <span>Pages</span>
      </button>

      <Sep />

      <button className={toolBtn('select')} ...>  {/* 기존 Select 버튼 */}
```

> **주의**: 기존 `<div className="flex items-center gap-0.5 shrink-0">` 여는 태그 바로 뒤에 Pages 버튼을 추가하고, 그 다음에 `<Sep />`를 추가한 후 기존 Select 버튼이 이어지도록 한다.

- [ ] **Step 3: ActionBar 테스트 업데이트**

`src/components/toolbar/__tests__/ActionBar.test.tsx`를 열어 테스트 렌더링 시 누락된 필수 props를 추가한다. 테스트에서 ActionBar를 렌더링하는 모든 곳에 `isPanelOpen={false}` 와 `onTogglePanel={vi.fn()}` 을 추가한다.

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```
npx vitest run src/components/toolbar/__tests__/ActionBar.test.tsx
```
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/components/toolbar/ActionBar.tsx src/components/toolbar/__tests__/ActionBar.test.tsx
git commit -m "feat: add Pages panel toggle button to ActionBar editor toolbar"
```

---

## Task 6: App.tsx — 전체 연결 및 레이아웃

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: import 추가**

`src/App.tsx` 파일 상단 import 목록에 추가:

```typescript
import { PagePanel } from './components/panel/PagePanel'
import {
  deletePages,
  insertBlankPage,
  insertPagesFromPdf,
  reorderPages,
} from './services/pdfPageService'
```

- [ ] **Step 2: 상태 및 훅 구조 분해 추가**

`useState` 선언 블록에 추가 (기존 `isExporting` 바로 아래):

```typescript
const [isPanelOpen,      setIsPanelOpen]      = useState(false)
const [isPageOperating,  setIsPageOperating]  = useState(false)
```

`useAnnotations` 구조 분해에 `remapAnnotations` 추가:

```typescript
const {
  annotations,
  selectedId,
  activeMode,
  addAnnotation,
  updateAnnotation,
  removeAnnotation,
  selectAnnotation,
  setActiveMode,
  remapAnnotations,   // ← 추가
} = useAnnotations()
```

- [ ] **Step 3: handlePageOperation 헬퍼 및 페이지 조작 핸들러 추가**

export 핸들러들 아래 (`handleDeleteSelected` 등 부근)에 추가:

```typescript
  // ── 페이지 조작 공통 처리 ──────────────────────────────────────────────────
  const handlePageOperation = useCallback((
    newBytes: ArrayBuffer,
    pageMapping: Map<number, number>,
  ) => {
    remapAnnotations(pageMapping)
    // file을 교체하면 usePdfDocument가 재로드하고 fileBytes useEffect도 갱신됨
    const name = file?.name ?? 'document.pdf'
    setFile(new File([newBytes], name, { type: 'application/pdf' }))
    setCurrentPage(1)
    setScrollToPage(1)
    setIsPageOperating(false)
  }, [remapAnnotations, file])

  const handleDeletePages = useCallback(async (pageNums: number[]) => {
    if (!fileBytes) return
    setIsPageOperating(true)
    try {
      const { newBytes, pageMapping } = await deletePages(fileBytes, pageNums)
      handlePageOperation(newBytes, pageMapping)
    } catch (err) {
      console.error('페이지 삭제 실패:', err)
      setIsPageOperating(false)
    }
  }, [fileBytes, handlePageOperation])

  const handleInsertBlankPage = useCallback(async (afterPage: number) => {
    if (!fileBytes) return
    setIsPageOperating(true)
    try {
      const { newBytes, pageMapping } = await insertBlankPage(fileBytes, afterPage)
      handlePageOperation(newBytes, pageMapping)
    } catch (err) {
      console.error('빈 페이지 삽입 실패:', err)
      setIsPageOperating(false)
    }
  }, [fileBytes, handlePageOperation])

  const handleInsertFromPdf = useCallback(async (afterPage: number, srcBytes: ArrayBuffer) => {
    if (!fileBytes) return
    setIsPageOperating(true)
    try {
      const { newBytes, pageMapping } = await insertPagesFromPdf(fileBytes, srcBytes, afterPage)
      handlePageOperation(newBytes, pageMapping)
    } catch (err) {
      console.error('PDF 병합 실패:', err)
      alert(`PDF를 삽입할 수 없습니다: ${err instanceof Error ? err.message : String(err)}`)
      setIsPageOperating(false)
    }
  }, [fileBytes, handlePageOperation])

  const handleReorderPages = useCallback(async (newOrder: number[]) => {
    if (!fileBytes) return
    setIsPageOperating(true)
    try {
      const { newBytes, pageMapping } = await reorderPages(fileBytes, newOrder)
      handlePageOperation(newBytes, pageMapping)
    } catch (err) {
      console.error('페이지 순서 변경 실패:', err)
      setIsPageOperating(false)
    }
  }, [fileBytes, handlePageOperation])
```

- [ ] **Step 4: actionBarProps에 새 props 추가**

```typescript
  const actionBarProps = {
    // ... 기존 props ...
    isPanelOpen,                              // ← 추가
    onTogglePanel: () => setIsPanelOpen(v => !v),  // ← 추가
  }
```

- [ ] **Step 5: JSX 레이아웃 변경**

`return` 문에서 `<main>` 바깥을 감싸는 구조를 추가한다.

변경 전:
```tsx
    <main
      className="flex-1 overflow-hidden"
      ...
    >
```

변경 후:
```tsx
      {/* Pages 패널 + 뷰어를 가로로 배치 */}
      <div className="flex flex-1 overflow-hidden">
        {appMode === 'editor' && isPanelOpen && pdfDoc && (
          <PagePanel
            pdfDoc={pdfDoc}
            numPages={numPages}
            currentPage={currentPage}
            isOperating={isPageOperating}
            onScrollToPage={page => {
              setScrollToPage(page)
              if (viewMode === 'grid') setViewMode('single')
            }}
            onDeletePages={handleDeletePages}
            onInsertBlankPage={handleInsertBlankPage}
            onInsertFromPdf={handleInsertFromPdf}
            onReorderPages={handleReorderPages}
          />
        )}
        <main
          className="flex-1 overflow-hidden"
          ...
        >
          {/* 기존 main 내용 그대로 */}
        </main>
      </div>  {/* flex wrapper 닫기 */}
```

`</main>` 태그 뒤에 `</div>` 를 추가하는 것을 잊지 말 것.

- [ ] **Step 6: 전체 빌드 확인**

```
npx vitest run
```
Expected: 전체 테스트 PASS

```
npm run build
```
Expected: 빌드 성공, TypeScript 오류 없음

- [ ] **Step 7: 커밋**

```bash
git add src/App.tsx
git commit -m "feat: wire PagePanel into App with page operation handlers"
```

---

## Task 7: FullscreenView — 터치패드 수평 스와이프 네비게이션

**Files:**
- Modify: `src/components/viewer/FullscreenView.tsx`
- Modify: `src/components/viewer/__tests__/FullscreenView.test.tsx`

- [ ] **Step 1: 기존 테스트 확인**

```
npx vitest run src/components/viewer/__tests__/FullscreenView.test.tsx
```
Expected: PASS (기준점 확인)

- [ ] **Step 2: 수평 스와이프 테스트 추가**

`src/components/viewer/__tests__/FullscreenView.test.tsx`의 `describe('FullscreenView', ...)` 블록 맨 아래에 다음 두 테스트를 추가한다 (기존 패턴: `baseProps`, `fireEvent`, `screen.getByTestId` 사용):

```typescript
  it('수평 스와이프: deltaX를 80 초과 누산하면 다음 페이지로 이동', () => {
    render(<FullscreenView {...baseProps} />)
    // deltaX 30씩 3번 → 누산 90 > 임계값 80 → 다음 페이지
    fireEvent.wheel(window, { deltaX: 30, deltaY: 0 })
    fireEvent.wheel(window, { deltaX: 30, deltaY: 0 })
    fireEvent.wheel(window, { deltaX: 30, deltaY: 0 })
    expect(screen.getByTestId('page-2')).toBeInTheDocument()
  })

  it('수평 스와이프: deltaX를 -80 미만 누산하면 이전 페이지로 이동', () => {
    // 먼저 2페이지로 이동
    render(<FullscreenView {...baseProps} />)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByTestId('page-2')).toBeInTheDocument()
    // 왼쪽 스와이프 → 이전 페이지
    fireEvent.wheel(window, { deltaX: -30, deltaY: 0 })
    fireEvent.wheel(window, { deltaX: -30, deltaY: 0 })
    fireEvent.wheel(window, { deltaX: -30, deltaY: 0 })
    expect(screen.getByTestId('page-1')).toBeInTheDocument()
  })
```

- [ ] **Step 3: 테스트 실행 — 실패 확인**

```
npx vitest run src/components/viewer/__tests__/FullscreenView.test.tsx
```
Expected: 새 테스트 FAIL

- [ ] **Step 4: FullscreenView.tsx 수정**

`src/components/viewer/FullscreenView.tsx` 에서:

1. `wheelCooldownRef` 선언 바로 아래에 `deltaXAccRef` 추가:
```typescript
  const wheelCooldownRef = useRef(false)
  const deltaXAccRef     = useRef(0)     // ← 추가: 수평 스와이프 누산기
```

2. `onWheel` 핸들러 전체를 다음으로 교체:
```typescript
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()

      // Ctrl + wheel → 줌 (기존 동작 유지)
      if (e.ctrlKey) {
        const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP
        setZoom(z => +(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z + delta)).toFixed(2)))
        return
      }

      // 수평 스와이프 (터치패드 두 손가락 좌우): |deltaX| > |deltaY| 이면 수평 우선
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        deltaXAccRef.current += e.deltaX
        if (deltaXAccRef.current > 80) {
          deltaXAccRef.current = 0
          setCurrentPage(p => Math.min(p + step, maxPage))
        } else if (deltaXAccRef.current < -80) {
          deltaXAccRef.current = 0
          setCurrentPage(p => Math.max(p - step, 1))
        }
        return
      }

      // 수직 스크롤 시 수평 누산기 리셋 (대각선 스와이프 오작동 방지)
      deltaXAccRef.current = 0

      // 수직 scroll → 페이지 전환 (기존 쿨다운 로직 유지)
      if (wheelCooldownRef.current) return
      if (e.deltaY === 0) return
      wheelCooldownRef.current = true
      setTimeout(() => { wheelCooldownRef.current = false }, 350)
      if (e.deltaY > 0) {
        setCurrentPage(p => Math.min(p + step, maxPage))
      } else {
        setCurrentPage(p => Math.max(p - step, 1))
      }
    }
```

- [ ] **Step 5: 테스트 실행 — 통과 확인**

```
npx vitest run src/components/viewer/__tests__/FullscreenView.test.tsx
```
Expected: 전체 PASS

- [ ] **Step 6: 전체 테스트 실행**

```
npx vitest run
```
Expected: 전체 PASS

- [ ] **Step 7: 커밋**

```bash
git add src/components/viewer/FullscreenView.tsx src/components/viewer/__tests__/FullscreenView.test.tsx
git commit -m "feat: add touchpad horizontal swipe navigation in fullscreen view"
```

---

## 최종 확인

- [ ] `npm run dev` 로 앱을 실행한다
- [ ] Editor 모드 전환 후 ActionBar에 Pages 버튼 확인
- [ ] Pages 버튼 클릭 → 왼쪽 패널 열림/닫힘 확인
- [ ] 섬네일 렌더링 확인 (처음엔 회색 → 순차 로드)
- [ ] 페이지 클릭 → 해당 페이지로 스크롤 확인
- [ ] Ctrl+클릭으로 다중 선택, 삭제 확인
- [ ] 드래그 앤 드롭으로 페이지 순서 변경 확인
- [ ] "빈 페이지 삽입" 확인
- [ ] "다른 PDF에서 삽입" — PDF 파일 선택 후 병합 확인
- [ ] Export PDF → 페이지 조작이 반영된 PDF 생성 확인
- [ ] 풀스크린 모드에서 터치패드 수평 스와이프 확인
- [ ] `npm run lint` — 오류 없음 확인
