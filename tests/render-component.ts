import { createSSRApp, type Component } from "vue";
import { renderToString } from "vue/server-renderer";

export function renderComponent(
  component: unknown,
  props: Record<string, unknown>,
): Promise<string> {
  return renderToString(createSSRApp(ssrComponent(component), props));
}

function ssrComponent(value: unknown): Component {
  if (typeof value !== "object" || value === null || !("ssrRender" in value))
    throw new Error("Vapor component is missing its SSR renderer");
  return value;
}
