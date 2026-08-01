export type ScrollAxis = "horizontal" | "vertical";

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
