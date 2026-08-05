# WZ PDF — MCP Server

PDF 도구를 Claude에 노출하는 [Model Context Protocol](https://modelcontextprotocol.io) 서버입니다. WZ PDF의 핵심 로직(`pdf-lib`, `pdfjs-dist`, 한글 폰트)을 재사용해요.

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
      "args": ["D:/Workspace/PdfEditor/mcp/dist/server.js"]
    }
  }
}
```

> 경로는 절대 경로로. Claude Desktop 재시작 후 사용 가능.

## 제공 도구

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

## 좌표 시스템

`pdf-lib`은 **왼쪽 아래 원점** (PDF 표준). WZ PDF 앱의 좌표(왼쪽 위 원점)와 반대예요. 도장이나 텍스트 오버레이의 `y` 좌표를 지정할 때 주의:

```
페이지 높이가 842pt (A4)이고, 상단에서 100pt 위치에 도장을 찍으려면
→ y = 842 - 100 - stampHeight
```

## 개발

```bash
npm run dev    # tsx로 watch 없이 즉시 실행
npm run build  # TypeScript → dist/
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

워터마크/텍스트 오버레이에 한글이 포함되면 자동으로 Noto Sans KR을 임베드합니다. 영문만 있으면 Helvetica 사용 (출력 PDF 크기 절약). 폰트 파일은 `../public/fonts/NotoSansKR-Regular.otf`에서 읽어요.
