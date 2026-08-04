import { describe, expect, it } from "vite-plus/test";
import { catalogUpdateUrl } from "../src/catalog/update-link.ts";

const repositoryUrl = "https://github.com/Justineo/kmodels";
const commitSha = "a".repeat(40);

describe("catalog update link", () => {
  it("prefers the recorded Actions run for an automated catalog refresh", () => {
    expect(
      catalogUpdateUrl(repositoryUrl, {
        commitSha,
        actionRunUrl: "https://github.com/Justineo/kmodels/actions/runs/123456789",
      }),
    ).toBe("https://github.com/Justineo/kmodels/actions/runs/123456789");
  });

  it("falls back to the catalog-producing commit", () => {
    expect(catalogUpdateUrl(repositoryUrl, { commitSha })).toBe(
      `https://github.com/Justineo/kmodels/commit/${commitSha}`,
    );
  });

  it("does not trust an Actions URL from another repository", () => {
    expect(
      catalogUpdateUrl(repositoryUrl, {
        commitSha,
        actionRunUrl: "https://github.com/another/project/actions/runs/123456789",
      }),
    ).toBe(`https://github.com/Justineo/kmodels/commit/${commitSha}`);
  });

  it("uses the commit when the recorded Actions URL is malformed", () => {
    expect(catalogUpdateUrl(repositoryUrl, { commitSha, actionRunUrl: "not a URL" })).toBe(
      `https://github.com/Justineo/kmodels/commit/${commitSha}`,
    );
  });
});
