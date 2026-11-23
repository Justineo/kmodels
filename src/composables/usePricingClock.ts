import { onBeforeUnmount, onMounted, ref } from "vue";

const MAX_TIMEOUT_MS = 2_147_483_647;

export function usePricingClock(nextChangeEpochMs: (nowMs: number) => number | undefined) {
  const now = ref(new Date().toISOString());
  let timer: ReturnType<typeof setTimeout> | undefined;

  function clear(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  function schedule(): void {
    clear();
    const currentMs = Date.now();
    now.value = new Date(currentMs).toISOString();
    const nextMs = nextChangeEpochMs(currentMs);
    if (nextMs === undefined || !Number.isFinite(nextMs)) return;
    const delay = Math.min(Math.max(nextMs - currentMs + 1, 1), MAX_TIMEOUT_MS);
    timer = setTimeout(schedule, delay);
  }

  onMounted(schedule);
  onBeforeUnmount(clear);

  return { now, schedule };
}
