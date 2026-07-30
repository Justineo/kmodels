import { join } from "node:path";
import { rootDirectory } from "./io.ts";

export interface ProjectionPaths {
  uiManifest: string;
  uiPack: string;
  exportManifest: string;
  exportPack: string;
}

export const defaultProjectionPaths: ProjectionPaths = {
  uiManifest: join(rootDirectory, "data/website-assets.json"),
  uiPack: join(rootDirectory, "data/website-assets.pack"),
  exportManifest: join(rootDirectory, "data/export-assets.json"),
  exportPack: join(rootDirectory, "data/export-assets.pack"),
};
