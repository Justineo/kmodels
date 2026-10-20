import { reactive } from "vue";
import type {
  WebsiteModel,
  WebsiteModelDetail,
  WebsiteProvider,
} from "./catalog/website-schema.ts";

interface DetailsState {
  model: WebsiteModel | undefined;
  providerName: string;
  provider: WebsiteProvider | undefined;
  dataVersion: string;
  detail: WebsiteModelDetail | undefined;
  loading: boolean;
  error: string | undefined;
  pricingTarget: string | undefined;
  close: () => void;
  navigate: (offset: -1 | 1) => void;
  retryModel: () => void;
}

export const detailsState = reactive<DetailsState>({
  model: undefined,
  providerName: "",
  provider: undefined,
  dataVersion: "",
  detail: undefined,
  loading: false,
  error: undefined,
  pricingTarget: undefined,
  close: () => undefined,
  navigate: () => undefined,
  retryModel: () => undefined,
});
