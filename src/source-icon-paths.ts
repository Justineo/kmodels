export const sourceIconDirectory = "/source-icons/";
export const sourceIconIndexPath = `${sourceIconDirectory}index.json`;

export function isSourceIconPath(path: unknown): path is string {
  return typeof path === "string" && /^\/source-icons\/[0-9a-f]{64}\.(?:png|ico)$/u.test(path);
}
