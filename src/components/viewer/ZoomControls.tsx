
interface ZoomControlsProps {
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
}

export function ZoomControls({ zoom, onZoomIn, onZoomOut, onZoomReset }: ZoomControlsProps) {
  return (
    <div className="flex flex-col items-center gap-1 mt-auto pb-4">
      <button
        onClick={onZoomIn}
        className="w-8 h-8 bg-gray-600 hover:bg-gray-500 text-white rounded text-xl leading-none"
        aria-label="Zoom in"
      >
        +
      </button>
      <button
        onClick={onZoomReset}
        className="text-xs text-gray-300 hover:text-white min-w-[2rem] text-center"
        aria-label="Reset zoom"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        onClick={onZoomOut}
        className="w-8 h-8 bg-gray-600 hover:bg-gray-500 text-white rounded text-xl leading-none"
        aria-label="Zoom out"
      >
        −
      </button>
    </div>
  )
}
