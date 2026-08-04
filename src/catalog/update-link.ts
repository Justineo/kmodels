export interface CatalogRevision {
  commitSha: string;
  actionRunUrl?: string;
}

const gitObjectId = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const actionRunId = /^[1-9]\d*$/u;

export function catalogUpdateUrl(
  repositoryUrl: string,
  { commitSha, actionRunUrl }: CatalogRevision,
): string {
  if (!gitObjectId.test(commitSha)) throw new Error("Catalog revision has an invalid commit SHA");

  const repository = new URL(repositoryUrl);
  if (repository.protocol !== "https:") throw new Error("Catalog repository URL must use HTTPS");
  repository.search = "";
  repository.hash = "";
  repository.pathname = repository.pathname.replace(/\/+$/u, "");

  if (actionRunUrl !== undefined) {
    try {
      const actionRun = new URL(actionRunUrl);
      const actionPathPrefix = `${repository.pathname}/actions/runs/`;
      const runId = actionRun.pathname.startsWith(actionPathPrefix)
        ? actionRun.pathname.slice(actionPathPrefix.length).replace(/\/$/u, "")
        : "";
      if (
        actionRun.protocol === "https:" &&
        actionRun.origin === repository.origin &&
        actionRunId.test(runId) &&
        actionRun.search === "" &&
        actionRun.hash === ""
      )
        return `${repository.origin}${actionPathPrefix}${runId}`;
    } catch {
      // Invalid or stale automation metadata uses the commit fallback below.
    }
  }

  return `${repository.href}/commit/${commitSha}`;
}
