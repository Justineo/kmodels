import { reactive } from "vue";
import type {
  WebsiteModel,
  WebsiteModelDetail,
  WebsiteProvider,
  WebsiteProviderPricingDetail,
} from "./catalog/website-schema.ts";

interface DetailsState {
  model: WebsiteModel | undefined;
  provider: WebsiteProvider | undefined;
  providerName: string;
  detail: WebsiteModelDetail | undefined;
  providerPricing: WebsiteProviderPricingDetail | undefined;
  loading: boolean;
  error: string | undefined;
  pricingTarget: string | undefined;
  close: () => void;
  navigate: (offset: -1 | 1) => void;
}

export const detailsState = reactive<DetailsState>({
  model: undefined,
  provider: undefined,
  providerName: "",
  detail: undefined,
  providerPricing: undefined,
  loading: false,
  error: undefined,
  pricingTarget: undefined,
  close: () => undefined,
  navigate: () => undefined,
});
