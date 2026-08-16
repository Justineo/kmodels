import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { shouldOpenTooltipOnClick, TooltipCoordinator } from "../src/composables/tooltip.ts";

afterEach(() => vi.useRealTimers());

describe("tooltip click policy", () => {
  it.each([
    ["plain text click", false, false, undefined, true],
    ["first click after focus opens text", false, false, "mouse", true],
    ["first click after hover switches text", false, false, "mouse", true],
    ["second pointer click on text", false, true, "touch", false],
    ["first touch on an action", true, false, "touch", true],
    ["second touch on an action", true, true, "touch", false],
    ["mouse action", true, false, "mouse", false],
    ["keyboard action", true, false, undefined, false],
  ] as const)("handles %s", (_name, isAction, activationOpen, pointerType, expected) => {
    expect(shouldOpenTooltipOnClick(isAction, activationOpen, pointerType)).toBe(expected);
  });
});

describe("tooltip coordinator", () => {
  it("warms up once and skips the delay during the shared cooldown", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const events: string[] = [];
    const coordinator = new TooltipCoordinator();
    const first = {
      show: () => events.push("show:first"),
      hide: () => events.push("hide:first"),
    };
    const second = {
      show: () => events.push("show:second"),
      hide: () => events.push("hide:second"),
    };

    coordinator.request(first);
    vi.advanceTimersByTime(699);
    expect(events).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(events).toEqual(["show:first"]);

    coordinator.release(first);
    vi.advanceTimersByTime(399);
    coordinator.request(second);
    expect(events).toEqual(["show:first", "hide:first", "show:second"]);

    coordinator.release(second);
    vi.advanceTimersByTime(401);
    coordinator.request(first);
    expect(events.at(-1)).toBe("hide:second");
    vi.advanceTimersByTime(700);
    expect(events.at(-1)).toBe("show:first");
  });

  it("cancels warm-up when a trigger is left before opening", () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const coordinator = new TooltipCoordinator();
    const client = {
      show: () => events.push("show"),
      hide: () => events.push("hide"),
    };

    coordinator.request(client);
    coordinator.release(client);
    vi.runAllTimers();
    expect(events).toEqual([]);
  });

  it("opens immediately when a pending trigger receives focus", () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const coordinator = new TooltipCoordinator();
    const client = {
      show: () => events.push("show"),
      hide: () => events.push("hide"),
    };

    coordinator.request(client);
    coordinator.request(client, true);
    expect(events).toEqual(["show"]);
    vi.runAllTimers();
    expect(events).toEqual(["show"]);
  });

  it("cancels pending and active tooltips when dismissed", () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const coordinator = new TooltipCoordinator();
    const client = {
      show: () => events.push("show"),
      hide: () => events.push("hide"),
    };

    coordinator.request(client);
    coordinator.dismiss();
    vi.runAllTimers();
    expect(events).toEqual([]);

    coordinator.request(client, true);
    coordinator.dismiss();
    coordinator.request(client);
    expect(events).toEqual(["show", "hide", "show"]);
  });
});
