declare module "*.vue" {
  import type { VaporComponent } from "vue";

  const component: VaporComponent;
  export default component;
}

declare const __KMODELS_CATALOG_UPDATE_URL__: string;
