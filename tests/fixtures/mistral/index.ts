import medium from "./mistral-medium-3-5-26-04";
import ocr from "./ocr-4-0";
import tts from "./voxtral-tts-26-03";
import large2 from "./mistral-large-2-0-24-07";
import large3 from "./mistral-large-3-25-12";

const defineModels = <T extends readonly unknown[]>(models: T): T => models;

export const MODELS = defineModels([medium, ocr, tts, large2, large3]);
