/**
 * Serialize async work PER KEY, independent across keys. Two taps on the same
 * control run in tap order (so the stored state ends as the last tap's), taps
 * on different controls never wait on each other. A failed task does not stop
 * later tasks for the same key.
 */
const tails = new Map<string, Promise<unknown>>();

export function enqueueByKey<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  const tail = run.then(
    () => undefined,
    () => undefined
  );
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}

/** Test helper: drop every pending tail so a never-settling mock in one test cannot block the next test's writes. */
export function resetKeyedQueuesForTests(): void {
  tails.clear();
}
