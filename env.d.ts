declare module "*.vue" {
  import type { VaporComponent } from "vue";

  const component: VaporComponent;
  export default component;
}
