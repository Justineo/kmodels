export type ScrollAxis = "horizontal" | "vertical";

export interface ScrollSample {
  position: number;
  time: number;
}

export function dominantScrollAxis(
  deltaX: number,
  deltaY: number,
  threshold: number,
): ScrollAxis | undefined {
  if (!Number.isFinite(threshold) || threshold < 0)
    throw new Error("Scroll direction threshold must be a non-negative number");
  const horizontalDistance = Math.abs(deltaX);
  const verticalDistance = Math.abs(deltaY);
  if (Math.max(horizontalDistance, verticalDistance) < threshold) return undefined;
  return horizontalDistance > verticalDistance ? "horizontal" : "vertical";
}

export function clampScrollPosition(
  position: number,
  scrollSize: number,
  viewportSize: number,
): number {
  const maximum = Math.max(0, scrollSize - viewportSize);
  return Math.min(maximum, Math.max(0, position));
}

export function recentScrollVelocity(
  samples: ReadonlyArray<ScrollSample>,
  endTime: number,
  sampleWindow: number,
): number {
  if (!Number.isFinite(sampleWindow) || sampleWindow <= 0)
    throw new Error("Scroll velocity sample window must be a positive number");
  const cutoff = endTime - sampleWindow;
  let first: ScrollSample | undefined;
  let last: ScrollSample | undefined;
  for (const sample of samples) {
    if (sample.time < cutoff || sample.time > endTime) continue;
    first ??= sample;
    last = sample;
  }
  if (first === undefined || last === undefined) return 0;
  const elapsed = last.time - first.time;
  return elapsed > 0 ? (last.position - first.position) / elapsed : 0;
}
