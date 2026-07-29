let firstPaint: Promise<void> | undefined;

export function afterFirstPaint(): Promise<void> {
  firstPaint ??= new Promise((resolve) => {
    const finish = () => setTimeout(resolve);
    if (
      typeof PerformanceObserver === "function" &&
      PerformanceObserver.supportedEntryTypes.includes("paint")
    ) {
      if (performance.getEntriesByName("first-contentful-paint").length > 0) {
        finish();
        return;
      }
      const observer = new PerformanceObserver((entries) => {
        if (!entries.getEntries().some(({ name }) => name === "first-contentful-paint")) return;
        observer.disconnect();
        finish();
      });
      observer.observe({ type: "paint", buffered: true });
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(finish));
  });
  return firstPaint;
}
