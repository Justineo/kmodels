import { createVaporApp } from "vue";
import DetailsHost from "./DetailsHost.vue";

let mounted = false;

export function mountDetailsApp(): void {
  if (mounted) return;
  const root = document.querySelector("#details-app");
  if (root === null) throw new Error("Missing model details mount point");
  createVaporApp(DetailsHost).mount(root);
  mounted = true;
}
