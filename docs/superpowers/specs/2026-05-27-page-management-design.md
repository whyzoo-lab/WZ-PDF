# Page Management Feature Design

**Date:** 2026-05-27  
**Feature:** PDF 페이지 삭제 / 추가 / 순서변경 / 병합  
**Scope:** Editor 모드 전용

---

## 1. 목표

Editor 모드에서 왼쪽 섬네일 패널을 통해 PDF 페이지를 삭제, 추가(빈 페이지 또는 다른 PDF 병합), 순서 변경할 수 있도록 한다. 조작 결과는 즉시 `fileBytes`에 반영되어 기존 Export(PDF / HTML / 이미지 / EXE) 경로와 연동된다.

---

## 2. 아키텍처

### 신규 파일

| 파일 | 역할 |
|---|---|
| `src/services/pdfPageService.ts` | 페이지 조작 순수 함수 (pdf-lib 사용) |
| `src/components/panel/PagePanel.tsx` | 섬네일 패널 UI |
| `src/hooks/useThumbnails.ts` | pdfjs lazy 섬네일 렌더링 훅 |
| `src/services/__tests__/pdfPageService.test.ts` | 서비스 단위 테스트 |

### 수정 파일

| 파일 | 변경 내용 |
|---|---|
| `src/hooks/useAnnotations.ts` | `remapAnnotations(Map<number,number>)` 콜백 추가 |
| `src/components/toolbar/ActionBar.tsx` | `isPanelOpen`, `onTogglePanel` prop 추가 / Pages 토글 버튼 |
| `src/App.tsx` | `isPanelOpen` 상태, `handlePageOperation` 콜백 추가 |

---

## 3. 데이터 흐름

```
사용자 조작 (PagePanel)
  → pdfPageService.xxx(fileBytes, …)  → { newBytes: ArrayBuffer, pageMapping: Map<number,number> }
  → App.tsx onPageOperation(newBytes, pageMapping) 콜백 호출
      1. new File([newBytes], file.name)  →  setFile()  →  usePdfDocument 재로드
      2. setFileBytes(newBytes)
      3. useAnnotations.remapAnnotations(pageMapping)
      4. setCurrentPage(1), setScrollToPage(1)
```

`usePdfDocument`는 `file` 객체가 바뀌면 자동으로 새 pdfDoc을 로드한다.  
pdfjs WeakMap 렌더 캐시는 새 page 객체 기준으로 자동 갱신 — 별도 초기화 불필요.

---

## 4. `pdfPageService.ts` API

모든 함수는 `{ newBytes, pageMapping }` 을 반환한다.  
`pageMapping: Map<oldPage, newPage>` — 매핑에 없는 oldPage의 어노테이션은 제거된다.

```typescript
type PageOpResult = {
  newBytes: ArrayBuffer
  pageMapping: Map<number, number>
}

// 지정 페이지들을 삭제 (1-based)
deletePages(bytes: ArrayBuffer, pageNums: number[]): Promise<PageOpResult>

// 지정 페이지 뒤에 빈 페이지 삽입 (크기는 앞 페이지 기준, afterPage=0이면 맨 앞)
insertBlankPage(bytes: ArrayBuffer, afterPage: number): Promise<PageOpResult>

// 지정 페이지 뒤에 다른 PDF 전체를 삽입
insertPagesFromPdf(bytes: ArrayBuffer, srcBytes: ArrayBuffer, afterPage: number): Promise<PageOpResult>

// 페이지 순서 재배열
// newOrder[i] = 새 i+1번 위치에 놓일 원래 페이지 번호 (1-based)
reorderPages(bytes: ArrayBuffer, newOrder: number[]): Promise<PageOpResult>
```

### 어노테이션 리매핑 규칙

| 조작 | 매핑 예시 (3페이지 기준) |
|---|---|
| 2페이지 삭제 | `{1→1, 3→2}` (2번 어노테이션 제거) |
| 1번 뒤 빈 페이지 삽입 | `{1→1, 2→3, 3→4}` |
| 순서 `[3,1,2]` 변경 | `{3→1, 1→2, 2→3}` |

---

## 5. `PagePanel` UI

### 레이아웃

- **위치**: 메인 콘텐츠 왼쪽 (PdfViewer를 오른쪽으로 밀어냄, overlay 아님)
- **너비**: 160px 고정, 수직 스크롤 가능
- **표시 조건**: Editor 모드 + `isPanelOpen === true`

```
┌──────────┬───────────────────────────┐
│ Pages [×]│                           │
│──────────│      PdfViewer            │
│[+추가 ▾] │                           │
│[🗑 삭제] │                           │
│──────────│                           │
│ ┌──────┐ │                           │
│ │  🖼  │ │                           │
│ │  1   │ │                           │
│ └──────┘ │                           │
│ ┌──────┐ │                           │
│ │  🖼  │ │ ← 선택 시 파란 테두리     │
│ │  2 ✓ │ │                           │
│ └──────┘ │                           │
└──────────┴───────────────────────────┘
```

### ActionBar 변경

Editor 모드 도구 영역 맨 앞에 Pages 토글 버튼 추가:

```
[ ◫ Pages ] | [ ▶ Select ] [ 🔖 Stamp▾ ] [ ✍ Sign ] [ W Mark ]
```

### 인터랙션

| 동작 | 결과 |
|---|---|
| 섬네일 클릭 | 해당 페이지로 스크롤 (`scrollToPage` 업데이트) |
| Ctrl+클릭 | 다중 선택 토글 |
| Shift+클릭 | 범위 선택 |
| 드래그 앤 드롭 | 페이지 순서 변경 (드롭 위치에 파란 선 표시) |
| `[+ 추가 ▾]` | 드롭다운: "빈 페이지 삽입" / "다른 PDF에서 삽입…" (삽입 위치: 선택 페이지가 있으면 마지막 선택 페이지 뒤, 없으면 `currentPage` 뒤) |
| `[🗑 삭제 (N)]` | N개 선택 시 활성화, 클릭 시 확인 다이얼로그 → 실행 |

---

## 6. `useThumbnails` 훅

```typescript
function useThumbnails(
  pdfDoc: PDFDocumentProxy | null,
  numPages: number,
): HTMLCanvasElement[]
```

- 기존 `useInViewport` 훅을 재사용한 lazy 렌더링
- 렌더 scale: `0.2` (약 100px 너비의 섬네일)
- 마운트 후 유지 (un-mount 시 재렌더 방지)

---

## 7. `useAnnotations` 변경

```typescript
// 추가되는 콜백
remapAnnotations: (mapping: Map<number, number>) => void
```

구현: `mapping`에 있는 페이지는 새 번호로 업데이트, 없는 페이지의 어노테이션은 제거.  
`WatermarkAnnotation`의 `allPages: true`인 경우 page 번호 무관하므로 항상 유지.

---

## 8. 에러 처리

- 전체 페이지를 삭제하려는 경우 → 마지막 1페이지는 삭제 불가 (UI에서 비활성화)
- 다른 PDF 삽입 시 파일 로드 실패 → 토스트 에러 메시지 (기존 에러 표시 패턴 사용)
- 조작 중 `isExporting` 플래그와 동일하게 UI 비활성화 (별도 `isPageOperating` 상태)

---

## 9. 테스트 범위

`pdfPageService.test.ts`에서 커버:

- `deletePages`: 단일 / 다중 삭제, 매핑 정확성
- `insertBlankPage`: afterPage=0 (맨 앞), 중간, 맨 뒤
- `insertPagesFromPdf`: 다른 PDF 병합, 페이지 수 합산
- `reorderPages`: 역순, 단일 이동

---

## 10. 스코프 외 (이번 구현 제외)

- 페이지 회전 (현재 회전은 뷰어 전용, PDF에 영구 저장 아님)
- 페이지 크롭
- 실행 취소(Undo) / 다시 실행(Redo)
