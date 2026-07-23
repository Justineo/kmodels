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
