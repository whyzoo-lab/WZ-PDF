// The name written on comments (/T), kept in userData/comment-author.json. It
// starts as the OS account name — what Acrobat does — and the reader can
// change it in the comments panel.

import fs from 'fs'
import os from 'os'
import path from 'path'

const FILE = 'comment-author.json'
const MAX = 64

export function cleanAuthor(v: unknown): string {
  if (typeof v !== 'string') return ''
  // Control characters dropped: the name goes into the PDF and onto the screen.
  const printable = [...v].filter(c => { const code = c.codePointAt(0) ?? 0; return code >= 0x20 && code !== 0x7f }).join('')
  return printable.trim().slice(0, MAX)
}

function accountName(): string {
  try { return cleanAuthor(os.userInfo().username) } catch { return '' }
}

export function readCommentAuthor(userData: string): string {
  try {
    const stored = cleanAuthor(JSON.parse(fs.readFileSync(path.join(userData, FILE), 'utf8'))?.name)
    if (stored) return stored
  } catch { /* none yet */ }
  return accountName()
}

export function writeCommentAuthor(userData: string, value: unknown): string {
  const name = cleanAuthor(value)
  fs.writeFileSync(path.join(userData, FILE), JSON.stringify({ name }))
  return name || accountName()
}
