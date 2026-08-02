const TOOLTIP_WARM_UP_MS = 700;
const TOOLTIP_COOLDOWN_MS = 400;
export type TooltipTrigger = "button" | "span";

export function shouldOpenTooltipOnClick(
  trigger: TooltipTrigger,
  activationOpen: boolean,
  pointerType: string | undefined,
): boolean {
  return !activationOpen && (trigger === "span" || pointerType === "touch");
}

export interface TooltipClient {
  show: () => void;
  hide: () => void;
}

export class TooltipCoordinator {
  private active: TooltipClient | undefined;
  private pending: TooltipClient | undefined;
  private pendingTimer: ReturnType<typeof setTimeout> | undefined;
  private cooldownUntil = 0;
  private readonly warmUp: number;
  private readonly cooldown: number;

  constructor(warmUp = TOOLTIP_WARM_UP_MS, cooldown = TOOLTIP_COOLDOWN_MS) {
    this.warmUp = warmUp;
    this.cooldown = cooldown;
  }

  request(client: TooltipClient, immediate = false): void {
    if (this.active === client || (this.pending === client && !immediate)) return;
    this.cancelPending();

    const switching = this.active !== undefined;
    if (this.active !== undefined) {
      this.active.hide();
      this.active = undefined;
      this.cooldownUntil = Date.now() + this.cooldown;
    }

    if (immediate || switching || Date.now() < this.cooldownUntil) {
      this.activate(client);
      return;
    }

    this.pending = client;
    this.pendingTimer = setTimeout(() => {
      if (this.pending !== client) return;
      this.pending = undefined;
      this.pendingTimer = undefined;
      this.activate(client);
    }, this.warmUp);
  }

  release(client: TooltipClient): void {
    if (this.pending === client) this.cancelPending();
    if (this.active !== client) return;
    client.hide();
    this.active = undefined;
    this.cooldownUntil = Date.now() + this.cooldown;
  }

  private activate(client: TooltipClient): void {
    this.active = client;
    client.show();
  }

  private cancelPending(): void {
    if (this.pendingTimer !== undefined) clearTimeout(this.pendingTimer);
    this.pending = undefined;
    this.pendingTimer = undefined;
  }
}

export const tooltipCoordinator = new TooltipCoordinator();
