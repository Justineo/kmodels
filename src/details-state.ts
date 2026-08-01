import { reactive } from "vue";
import type { WebsiteModel, WebsiteModelDetail } from "./catalog/website-schema.ts";

interface DetailsState {
  model: WebsiteModel | undefined;
  providerName: string;
  detail: WebsiteModelDetail | undefined;
  loading: boolean;
  error: string | undefined;
  pricingTarget: string | undefined;
  close: () => void;
  navigate: (offset: -1 | 1) => void;
}

export const detailsState = reactive<DetailsState>({
  model: undefined,
  providerName: "",
  detail: undefined,
  loading: false,
  error: undefined,
  pricingTarget: undefined,
  close: () => undefined,
  navigate: () => undefined,
});
