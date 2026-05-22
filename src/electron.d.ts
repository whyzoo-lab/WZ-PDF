interface Window {
  electronAPI?: {
    onOpenFile: (callback: (filePath: string) => void) => void
  }
}
