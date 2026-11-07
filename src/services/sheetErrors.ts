// Kept apart from sheetDoc.ts so the page can recognise the error without
// loading the spreadsheet readers (they run in services/sheetWorker.ts).

/** Thrown for a workbook saved with a password ("암호로 보호된 통합 문서"). */
export class EncryptedWorkbookError extends Error {
  constructor() { super('encrypted workbook') }
}
