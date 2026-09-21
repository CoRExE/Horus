// Await the entire operation (including cleanup) before starting the next episode.
export async function runDownloadBatch<T>(
  items: T[],
  download: (item: T) => Promise<string | undefined>,
  cancelled: () => boolean,
  progress: (item: T, index: number, total: number) => void,
) {
  const failures: { item: T; error: string }[] = [];
  let completed = 0;
  for (const [index, item] of items.entries()) {
    if (cancelled()) break;
    progress(item, index + 1, items.length);
    try {
      const error = await download(item);
      if (cancelled()) break;
      if (error) failures.push({ item, error });
      else completed++;
    } catch (error) {
      if (cancelled()) break;
      failures.push({ item, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { completed, failures, cancelled: cancelled() };
}
