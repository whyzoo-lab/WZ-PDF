/**
 * What every view shows while a document is being read or laid out: a turning
 * ring over a bar that keeps moving, and what is happening in words. A large
 * workbook takes seconds to read, and a still line of text over that long reads
 * as the app having stopped.
 *
 * Both animations stop for readers who ask for less motion (the label stays).
 */
export default function LoadingIndicator({ label }: { label: string }) {
  return (
    <div role="status" className="flex h-full flex-col items-center justify-center gap-3 select-none text-sm text-gray-500 dark:text-gray-400">
      <span
        aria-hidden="true"
        className="h-9 w-9 animate-spin rounded-full border-[3px] border-gray-300 border-t-blue-500 motion-reduce:animate-none dark:border-gray-600 dark:border-t-blue-400"
      />
      <span>{label}</span>
      <span aria-hidden="true" className="wz-loading-bar h-1 w-32 overflow-hidden rounded-full bg-gray-300 dark:bg-gray-700" />
    </div>
  )
}
