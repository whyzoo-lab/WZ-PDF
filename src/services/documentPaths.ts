// Where an opened file lives on disk, when it came from there.
//
// The renderer holds documents as File objects, which carry no path. Opening a
// picture needs its folder (to bring the neighbouring pictures along), so App
// records the path of every file it opens from disk here. Kept apart from the
// image code so recording a path costs the startup bundle nothing.

const paths = new WeakMap<object, string>()

export function rememberPath(file: object, path: string): void {
  paths.set(file, path)
}

export function pathOf(file: object): string | undefined {
  return paths.get(file)
}
