import { once } from "node:events";
import { Worker } from "node:worker_threads";

const workerCount = 4;

export async function runWorkerPool<Task, Result>(
  tasks: readonly Task[],
  workerUrl: URL,
  readResult: (message: unknown, task: Task) => Result,
): Promise<Result[]> {
  const results: ({ value: Result } | undefined)[] = Array.from({ length: tasks.length });
  let nextTask = 0;
  await Promise.all(
    Array.from({ length: Math.min(workerCount, tasks.length) }, async () => {
      const worker = new Worker(workerUrl);
      try {
        while (nextTask < tasks.length) {
          const index = nextTask;
          nextTask += 1;
          const task = tasks[index];
          if (task !== undefined)
            results[index] = { value: await runTask(worker, task, readResult) };
        }
      } finally {
        await worker.terminate();
      }
    }),
  );
  return results.map((result) => {
    if (result === undefined) throw new Error("Worker task did not produce a result");
    return result.value;
  });
}

function runTask<Task, Result>(
  worker: Worker,
  task: Task,
  readResult: (message: unknown, task: Task) => Result,
): Promise<Result> {
  const response: Promise<unknown[]> = once(worker, "message");
  worker.postMessage(task);
  return response.then(([message]) => readResult(message, task));
}
