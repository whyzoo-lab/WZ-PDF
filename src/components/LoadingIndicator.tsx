import MobiusLoader from './MobiusLoader'

/**
 * What every view shows while a document is being read or laid out: a ring of
 * light travelling round a turning Möbius strip (MobiusLoader), and what is
 * happening in words. A large workbook takes seconds to read, and a still line
 * of text over that long reads as the app having stopped.
 *
 * The animation holds still for readers who ask for less motion (the label stays).
 */
export default function LoadingIndicator({ label }: { label: string }) {
  return (
    <div role="status" className="flex h-full flex-col items-center justify-center gap-2 select-none text-sm text-gray-500 dark:text-gray-400">
      <MobiusLoader />
      <span>{label}</span>
    </div>
  )
}
