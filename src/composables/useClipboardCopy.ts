import { onBeforeUnmount, ref } from "vue";

export function useClipboardCopy(timeoutMs = 2_000) {
  const copiedValue = ref<string | undefined>(undefined);
  const announcement = ref("");
  let resetTimer: ReturnType<typeof setTimeout> | undefined;

  function reset(): void {
    copiedValue.value = undefined;
    announcement.value = "";
    if (resetTimer !== undefined) clearTimeout(resetTimer);
    resetTimer = undefined;
  }

  async function copy(value: string): Promise<void> {
    reset();
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      copiedValue.value = undefined;
      announcement.value = `Could not copy ${value}`;
      return;
    }
    copiedValue.value = value;
    announcement.value = `Copied ${value}`;
    resetTimer = setTimeout(reset, timeoutMs);
  }

  onBeforeUnmount(reset);

  return { copiedValue, announcement, copy, reset };
}
