/**
 * Injects a fine-grained PAT into an https clone URL so the worker can clone a private repo
 * without configuring a git credential helper. Cloning happens on the host (see package README
 * for why), so the token is only ever in this process's memory/argv, never inside a sandbox
 * container.
 */
export function buildAuthenticatedCloneUrl(cloneUrl: string, token?: string): string {
  if (!token) {
    return cloneUrl;
  }
  const url = new URL(cloneUrl);
  url.username = "x-access-token";
  url.password = token;
  return url.toString();
}
