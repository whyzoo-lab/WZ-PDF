/** Korean messages. Keys mirror en.ts exactly. */
export const ko = {
  // ── Branding / empty state ────────────────────────────────────────────────
  'app.tagline': 'PDF를 쉽고 빠르게',
  'empty.desktop': 'PDF · HWP · EML · 이미지 · Markdown을 여기에 드래그하거나 Open 버튼 또는 F2를 누르세요',
  'empty.mobile': '탭하거나 Open 버튼으로 PDF · HWP · EML · 이미지 · Markdown을 여세요',

  // ── Toolbar tooltips (title / aria-label) ─────────────────────────────────
  'tool.single': '한 장 보기',
  'tool.spread': '두 장 보기',
  'tool.grid': '전체 보기',
  'tool.fullscreen': '전체화면 (F5)',
  'tool.zoomOut': '축소',
  'tool.zoomReset': '배율 초기화',
  'tool.zoomIn': '확대',
  'tool.rotate': '90° 회전 (현재: {deg}°)',
  'tool.pages': '페이지 패널 열기/닫기',
  'tool.reset': '화면 필기 지우기 (형광펜 / 사각형)',
  'tool.select': '선택',
  'tool.stamp': '도장',
  'tool.signature': '서명',
  'tool.watermark': '워터마크',
  'tool.delete': '선택 항목 삭제',
  'tool.viewer': '뷰어 모드 — 읽기 전용',
  'tool.editor': '편집 모드 — 도장 · 서명 · 워터마크',
  // Short labels shown inside the viewer/editor segmented switch.
  // Accessible label for the edit-lock switch (locked = read-only viewer).
  'tool.editLock': '편집 잠금',
  'tool.open': 'PDF 열기 (F2)',
  'tool.print': '인쇄 (Ctrl+P)',
  'tool.export': '내보내기',
  'tool.exporting': '내보내는 중…',
  'tool.exportPdf': 'PDF 다운로드',
  'tool.exportMore': '다른 형식',
  'tool.zoomLevel': '확대·축소 비율 (%)',
  'tool.menuLeft': '보기 · 도구',
  'tool.menuRight': '작업',

  // ── Stamp menu ────────────────────────────────────────────────────────────
  'stamp.uploadImage': '이미지 업로드…',

  // ── Export menu ───────────────────────────────────────────────────────────
  'export.pdf': 'PDF 저장',
  'export.html': 'HTML 저장',
  'export.images': '이미지 저장',
  'export.exe': 'EXE Viewer',
  'export.pdfDone': 'PDF 저장 완료 — {name}',
  'export.htmlDone': 'HTML 저장 완료 — {name}',
  'export.imagesDone': '이미지 저장 완료 — {name}',
  'export.exeDone': 'EXE Viewer 저장 완료',
  'export.imagesFailed': '이미지 내보내기 실패: {error}',
  'export.htmlFailed': 'HTML 내보내기 실패: {error}',
  'export.exeFailed': 'EXE 내보내기 실패\n\n{error}',
  'export.exeError': 'EXE 내보내기 오류: {error}',
  'export.exeUnknownError': '알 수 없는 오류',
  'export.exeWebPrompt':
    'EXE Viewer 기능은 데스크탑 앱 전용입니다.\n\nWZ PDF 설치 프로그램을 다운로드 받으시겠습니까?',

  // ── Print ─────────────────────────────────────────────────────────────────
  'print.preparing': '인쇄 준비 중…',
  'print.progress': '{done} / {total} 페이지',
  'print.previewTitle': '인쇄 미리보기',
  'print.previewHint': '실제 인쇄물과 동일하게 보입니다 — 도장 · 서명 · 워터마크 포함',
  'print.pageCount': '{total}페이지',
  'print.doPrint': '인쇄',
  'print.cancel': '취소',

  // ── Upload / file errors ──────────────────────────────────────────────────
  'error.pdfOnly': 'PDF 파일만 열 수 있습니다.',
  'error.openFailed': '파일을 열 수 없습니다: {error}',
  'error.pdfInsertFailed': 'PDF를 삽입할 수 없습니다: {error}',

  // ── Page panel ────────────────────────────────────────────────────────────
  'panel.title': 'Pages',
  'panel.close': '패널 닫기',
  'panel.add': '+ 추가 ▾',
  'panel.addTitle': '페이지 추가',
  'panel.insertBlank': '빈 페이지 삽입',
  'panel.insertFromPdf': '다른 PDF에서 삽입…',
  'panel.deleteN': '{n}개 페이지 삭제',
  'panel.selectFirst': '페이지를 선택하세요',
  'panel.confirmDelete': '선택한 {n}개 페이지를 삭제할까요?',
  'panel.readError': 'PDF를 읽을 수 없습니다: {error}',
  'panel.processing': '처리 중…',

  // ── Open from URL ─────────────────────────────────────────────────────────
  'url.title': 'URL로 PDF 열기',
  'url.hint': 'PDF 파일의 직접 링크를 붙여넣으세요.',
  'url.load': '불러오기',
  'url.loading': '불러오는 중…',
  'url.cancel': '취소',
  'url.invalid': '올바른 http(s) URL을 입력하세요.',
  'url.loadFailed': 'PDF를 불러올 수 없습니다: {error}',
  'url.corsBlocked': 'PDF를 불러올 수 없습니다 — 해당 사이트가 외부 접근(CORS)을 차단합니다. 파일을 내려받아 직접 열거나 데스크탑 앱을 사용하세요.',
  'tool.openFile': '파일 열기…',
  'tool.openUrl': 'URL로 열기…',

  // ── HWP ───────────────────────────────────────────────────────────────────
  'hwp.engineError': 'HWP 엔진 로드 실패',
  'hwp.badge': 'HWP',

  // ── Region OCR (Ctrl+drag → copy) ─────────────────────────────────────────
  'region.recognizing': '인식 중…',
  'region.copied': '텍스트를 클립보드에 복사했어요',
  'region.noText': '인식된 텍스트가 없어요',
  'region.copyFailed': '클립보드 복사 실패',

  // ── OCR ───────────────────────────────────────────────────────────────────
  'ocr.runCurrent': 'OCR (현재 페이지)',
  'ocr.runAll': 'OCR (전체 문서)',
  'ocr.progress': 'OCR {done}/{total}',
  'ocr.noText': '인식된 텍스트가 없습니다',
  'ocr.engineError': 'OCR 엔진 로드 실패',
  'ocr.cancel': 'OCR 취소',
  'ocr.recognizing': '인식 중…',

  // ── 업데이트 알림 ─────────────────────────────────────────────────────────
  'update.available': '새 버전 {version} 사용 가능',
  'update.download': '최신 버전 다운로드',
  'update.dismiss': '닫기',

  // ── Search (Ctrl+F) ───────────────────────────────────────────────────────
  'search.placeholder': '문서에서 찾기',
  'search.noResults': '결과 없음',
  'search.next': '다음 일치 (Enter)',
  'search.prev': '이전 일치 (Shift+Enter)',
  'search.close': '닫기 (Esc)',

  // ── Error boundary ────────────────────────────────────────────────────────
  'errorBoundary.title': '문제가 발생했습니다',
  'errorBoundary.body': '뷰어에서 예기치 못한 오류가 발생했어요. 새로고침하면 대부분 해결됩니다.',
  'errorBoundary.reload': '새로고침',

  // ── Presenter tools (fullscreen ZoomIt-style HUD) ─────────────────────────
  'present.pen': '펜',
  'present.highlighter': '형광펜',
  'present.rect': '사각형',
  'present.arrow': '화살표',
  'present.laser': '레이저',
  'present.zoom': '스팟 줌',
  // ── Email (.eml) ──────────────────────────────────────────────────────────
  'email.from': '보낸사람',
  'email.to': '받는사람',
  'email.cc': '참조',
  'email.date': '날짜',
  'email.noSubject': '(제목 없음)',
  'email.noBody': '표시할 본문이 없습니다.',
  'email.attachments': '첨부파일',
  'email.download': '다운로드',
  'email.openHere': '뷰어에서 열기',
  'email.imagesBlocked': '외부 이미지 {n}개를 차단했습니다. 발신자에게 열람 사실이 알려질 수 있습니다.',
  'email.loadImages': '이미지 표시',
  // ── Markdown (.md) ────────────────────────────────────────────────────────
  'md.contents': '목차',
  'md.renderFailed': '이 마크다운 문서를 표시할 수 없습니다.',
  'md.source': '원본 (Markdown)',
  'md.save': '저장',
  'md.saved': '저장 완료 — {name}',
  'md.unsaved': '수정됨',
  'md.editHint': '편집 잠금을 풀면 원본을 그대로 수정할 수 있습니다.',
} as const
