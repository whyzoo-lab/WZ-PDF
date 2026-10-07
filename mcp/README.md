# WZ PDF — MCP Server

WZ PDF가 여는 문서 — PDF, 한글(HWP/HWPX), Word, PowerPoint, Excel·CSV, Markdown, 메일(.eml), 이미지 — 를 Claude가 읽고 PDF로 바꾸고 다룰 수 있게 해 주는 [Model Context Protocol](https://modelcontextprotocol.io) 서버입니다. WZ PDF의 핵심 로직(`pdf-lib`, `pdfjs-dist`, `hucre`, 메일 파서, 한글 폰트)을 재사용해요.

## 설치

```bash
cd mcp
npm install
npm run build
```

## Claude Desktop 연결

`%APPDATA%\Claude\claude_desktop_config.json` (Windows) 또는 `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) 에 추가:

```json
{
  "mcpServers": {
    "wz-pdf": {
      "command": "node",
      "args": ["D:/Workspace/PdfEditor/mcp/dist/mcp/src/server.js"]
    }
  }
}
```

> 경로는 절대 경로로. Claude Desktop 재시작 후 사용 가능.

## 제공 도구

### 모든 문서

| 도구 | 설명 |
|---|---|
| `doc_get_text` | 문서의 글을 읽습니다. PDF·HWP(쪽 단위), Word(표는 칸을 탭으로 구분), PowerPoint(슬라이드별, 발표자 노트 포함), Excel·ODS·CSV(시트별, 칸은 탭, `startRow`/`maxRows`로 나눠 읽기), Markdown, 메일(제목·보낸 사람·첨부 목록과 본문) |
| `doc_info` | 형식과 쪽·슬라이드(숨긴 슬라이드 포함)·시트(행 수), 메일의 제목·보낸 사람·첨부 |
| `doc_to_pdf` | 앱에서 "PDF로 저장"한 것과 같은 PDF로 변환 (HWP, Word, PowerPoint, Excel·CSV, Markdown, 메일, 이미지). 글자를 선택·검색할 수 있는 PDF |
| `hwp_to_pdf` | 한글 문서 → PDF (예전 이름; `doc_to_pdf`와 같은 결과) |

`doc_to_pdf`, 그리고 HWP에 대한 `doc_get_text`는 WZ PDF 앱이 필요합니다(아래 참고). 나머지는 서버 혼자 처리합니다.

### PDF

| 도구 | 설명 |
|---|---|
| `pdf_info` | 페이지 수·크기·메타데이터 조회 |
| `pdf_get_text` | 전체 또는 특정 페이지의 텍스트 추출 |
| `pdf_search` | 키워드 검색 (페이지 + 컨텍스트 반환) |
| `pdf_add_watermark` | 모든 페이지에 워터마크 (한글 OK) |
| `pdf_add_stamp` | 도장/이미지 배치 |
| `pdf_add_text_overlay` | 흰 박스 + 새 텍스트 덮어쓰기 (WZ PDF의 textEdit) |
| `pdf_split` | 페이지/범위별 분할 |
| `pdf_merge` | 여러 PDF 병합 |
| `pdf_delete_pages` | 페이지 삭제 |
| `pdf_reorder_pages` | 페이지 순서 변경 |
| `pdf_insert_blank` | 빈 페이지 삽입 |

## 사용 예시

Claude Desktop에 위 설정을 추가한 뒤 채팅에서:

> 📌 "D:/docs/report.pdf 페이지 수 알려줘"
> → `pdf_info` 자동 호출

> 📌 "D:/docs/contract.pdf의 5-7페이지를 D:/docs/extracted.pdf로 분리해줘"
> → `pdf_split({ ranges: "5-7", outputDir: "D:/docs" })`

> 📌 "D:/docs/proposal.pdf 모든 페이지에 빨간색 '대외비' 워터마크 넣고 secured.pdf로"
> → `pdf_add_watermark({ text: "대외비", color: "#FF0000", output: "..." })`

> 📌 "D:/docs/a.pdf, b.pdf, c.pdf 순서로 합쳐서 D:/docs/combined.pdf로"
> → `pdf_merge({ files: [...], output: "..." })`

> 📌 "D:/docs/manual.pdf에서 'AI 윤리'가 언급된 곳 다 찾아"
> → `pdf_search({ query: "AI 윤리" })`

> 📌 "D:/docs/발표자료.pptx 슬라이드별 내용과 발표자 노트 요약해줘"
> → `doc_get_text({ file: "D:/docs/발표자료.pptx" })`

> 📌 "D:/data/전국공장현황.xlsx에서 처음 100행만 보여줘"
> → `doc_get_text({ file: "...", maxRows: 100 })` — 이어서 읽으려면 응답에 적힌 `startRow`로 다시 호출

> 📌 "D:/docs/계약서.docx를 PDF로 바꿔서 '대외비' 워터마크 넣어줘"
> → `doc_to_pdf` → `pdf_add_watermark`

> ⚠️ 저장하는 도구는 `.pdf`로만 쓰고, 호출에 `overwrite: true`가 없으면 이미 있는
> 파일을 덮어쓰지 않습니다. 에이전트가 PDF에서 읽은 글은 믿을 수 없는 입력이라,
> 그 글에 속아 기존 문서를 덮어쓰는 일이 없어야 하기 때문입니다.

## 좌표 시스템

`pdf-lib`은 **왼쪽 아래 원점** (PDF 표준). WZ PDF 앱의 좌표(왼쪽 위 원점)와 반대예요. 도장이나 텍스트 오버레이의 `y` 좌표를 지정할 때 주의:

```
페이지 높이가 842pt (A4)이고, 상단에서 100pt 위치에 도장을 찍으려면
→ y = 842 - 100 - stampHeight
```

## 개발

```bash
npm run dev    # tsx로 watch 없이 즉시 실행
npm run build  # TypeScript → dist/ (서버는 dist/mcp/src/server.js — 앱의 메일 파서를 함께 컴파일하기 때문)
npm start      # 컴파일된 서버 실행
```

서버 로그는 stderr로 출력 (stdout은 JSON-RPC 전용).

## HTTP 서버 보안 설정

HTTP 전송은 기본적으로 `127.0.0.1`에만 바인딩됩니다.

```bash
MCP_SANDBOX_DIR=/trusted/workspace npm run start:http
```

외부 인터페이스에 공개하려면 호스트와 충분히 긴 인증 토큰을 함께 지정해야 합니다.
토큰 없이 비루프백 주소에 바인딩하려 하면 서버가 시작되지 않습니다.

```bash
MCP_HOST=0.0.0.0 MCP_SANDBOX_DIR=/trusted/workspace MCP_AUTH_TOKEN=replace-with-a-long-random-token npm run start:http
```

클라이언트는 `Authorization: Bearer <token>` 헤더를 전송해야 합니다. 샌드박스
내부의 심볼릭 링크가 외부 경로를 가리키는 경우에도 파일 접근은 거부됩니다.

## 한글 폰트

워터마크/텍스트 오버레이에 한글이 포함되면 자동으로 Noto Sans KR을 임베드합니다. 영문만 있으면 Helvetica 사용 (출력 PDF 크기 절약). 폰트 파일은 다음 순서로 찾습니다.

1. `MCP_KOREAN_FONT_PATH` 환경 변수 (지정하면 이 경로만 사용)
2. 설치된 앱: `<설치 폴더>/resources/app.asar/dist/fonts/NotoSansKR-Regular.otf` — 서버가 앱 실행 파일(`ELECTRON_RUN_AS_NODE`)로 돌기 때문에 asar 안의 파일을 그대로 읽습니다.
3. 소스 체크아웃: `../public/fonts/NotoSansKR-Regular.otf`

어디에도 없으면 찾아본 경로를 담은 오류를 돌려줍니다.

## Using the server that ships with the desktop app

Installing WZ PDF puts a ready-to-run server at:

```
<install folder>
esources\mcp\wz-pdf-mcp.mjs
```

**No Node.js install is required.** The app's own binary doubles as the Node
runtime through `ELECTRON_RUN_AS_NODE`, so the server runs on machines that have
nothing but WZ PDF.

Register it by adding this to your client's MCP configuration — for Claude
Desktop that is `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "wz-pdf": {
      "command": "C:\Program Files\WZ PDF\WZ PDF.exe",
      "args": ["C:\Program Files\WZ PDF\resources\mcp\wz-pdf-mcp.mjs"],
      "env": { "ELECTRON_RUN_AS_NODE": "1" }
    }
  }
}
```

Adjust both paths if you installed elsewhere. The installer deliberately does
**not** write this file for you: it belongs to another application, may already
hold servers you configured yourself, and its location and format are outside
our control.

### `doc_to_pdf` and `hwp_to_pdf`

The tools that are not pure Node. HWP renders into a browser canvas, and Word,
PowerPoint, spreadsheets, Markdown and mail are laid out as HTML and printed by
Chromium, so these delegate to the desktop app in the same headless mode the
`topdf` / `hwp2pdf` console tools use — meaning the PDF an agent gets is the
same file the app's "Save as PDF" produces, with selectable text.
`pdf_get_text` and `pdf_search` therefore work on the result immediately.
`doc_get_text` on a HWP document goes through the same conversion.

Everything else `doc_get_text` and `doc_info` read in the server itself: Word
and PowerPoint XML through JSZip, spreadsheets through hucre (the reader the app
uses; a large sheet is read only as far as the requested rows), mail through the
app's own parser (`src/services/emlParser.ts`), so EUC-KR bodies and encoded
Korean subjects come out right.

Set `WZPDF_APP` to the full path of `WZ PDF.exe` if the server cannot find it
(running from a source checkout, or an unusual install layout).
