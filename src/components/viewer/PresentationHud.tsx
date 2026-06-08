import type { PresentToolState } from '../../types/present'
import { isDrawingTool } from '../../utils/presentTools'
import { t } from '../../i18n'
import type { MessageKey } from '../../i18n'

const TOOL_LABEL: Record<string, MessageKey> = {
  pen: 'present.pen', highlighter: 'present.highlighter', rect: 'present.rect',
  arrow: 'present.arrow', laser: 'present.laser', zoom: 'present.zoom',
}

/** Bottom-left chip showing the active presenter tool / color / width. */
export function PresentationHud({ tool }: { tool: PresentToolState }) {
  if (!tool.kind) return null
  const label = t(TOOL_LABEL[tool.kind])
  const showColorWidth = isDrawingTool(tool.kind)
  return (
    <div className="fixed bottom-8 left-8 z-[58] flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-xs text-white pointer-events-none">
      <span className="font-semibold">{label}</span>
      {showColorWidth && (
        <>
          <span className="inline-block h-3 w-3 rounded-full" style={{ background: tool.color }} />
          <span className="tabular-nums text-gray-300">{tool.width}px</span>
        </>
      )}
    </div>
  )
}
