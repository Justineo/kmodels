import { z } from "zod";

export const linkedBundleSchema = z.object({
  index: z.object({ url: z.url(), body: z.string().min(1) }),
  documents: z.array(z.object({ url: z.url(), body: z.string().min(1) })),
});

export type LinkedBundle = z.infer<typeof linkedBundleSchema>;

export function linkedDocumentBody(
  bundle: LinkedBundle,
  pathname: string,
  errorMessage: string,
): string {
  const matches = bundle.documents.filter(({ url }) => new URL(url).pathname === pathname);
  const document = matches[0];
  if (matches.length !== 1 || document === undefined) throw new Error(errorMessage);
  return document.body;
}
