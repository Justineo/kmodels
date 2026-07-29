export function calculateVirtualRange({
  count,
  itemSize,
  overscan,
  scrollOffset,
  viewportSize,
}: {
  count: number;
  itemSize: number;
  overscan: number;
  scrollOffset: number;
  viewportSize: number;
}) {
  if (itemSize <= 0) throw new Error("Virtual item size must be positive");

  const safeCount = Math.max(0, Math.floor(count));
  const safeOverscan = Math.max(0, Math.floor(overscan));
  const safeOffset = Math.max(0, scrollOffset);
  const safeViewport = Math.max(0, viewportSize);
  const visibleStart = Math.floor(safeOffset / itemSize);
  const visibleEnd = Math.ceil((safeOffset + safeViewport) / itemSize);
  const start = Math.min(safeCount, Math.max(0, visibleStart - safeOverscan));
  const end = Math.min(safeCount, Math.max(start, visibleEnd + safeOverscan));

  return {
    start,
    end,
    paddingBefore: start * itemSize,
    paddingAfter: (safeCount - end) * itemSize,
  };
}

export function nearestItemScrollOffset({
  index,
  itemSize,
  scrollOffset,
  viewportSize,
}: {
  index: number;
  itemSize: number;
  scrollOffset: number;
  viewportSize: number;
}): number {
  if (itemSize <= 0) throw new Error("Virtual item size must be positive");

  const top = Math.max(0, Math.floor(index)) * itemSize;
  const current = Math.max(0, scrollOffset);
  const viewport = Math.max(0, viewportSize);
  if (top < current || viewport < itemSize) return top;

  const bottom = top + itemSize;
  return bottom > current + viewport ? bottom - viewport : current;
}
