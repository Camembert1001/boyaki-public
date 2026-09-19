// The one module in this tree that touches the network.
//
// It is deliberately small, deliberately read-only, and deliberately the only place a
// credential is ever seen. Three properties are worth stating because they are enforced
// here rather than hoped for elsewhere:
//
//   1. GET only. `request()` refuses any other method by name. There is no code path in
//      this repository that can POST, PATCH, PUT or DELETE against GitHub, which means
//      there is no code path that can open an issue, write a comment, or send anything to
//      a person. That is not a policy, it is the absence of a function.
//   2. No credential in source. The token is read from the environment at call time
//      (GITHUB_TOKEN or GH_TOKEN), never written to the manifest, never logged, never
//      defaulted to a literal. Without one the client still works against GitHub's
//      unauthenticated limits, which is what the default budget is sized for.
//   3. Rate-limit aware, and it stops rather than sleeps. When GitHub says the remaining
//      quota is zero the client reports it; the explorer halts its budget and writes the
//      manifest it has. A crawler that waits out a rate limit is a crawler that runs
//      unattended for an hour, which is not what this is.
//
// Everything here is injectable: `explore.mjs` takes a client object, and the tests pass a
// fake. No test in this repository makes a network call.
const API = 'https://api.github.com';

// The standard, documented endpoints. No scraping, no HTML parsing, no undocumented JSON.
export const ENDPOINTS = {
 search: '/search/repositories',
 tree: repo => '/repos/' + repo + '/git/trees/',
 contents: repo => '/repos/' + repo + '/contents/'
};

export class GitHubError extends Error {
 constructor(message, status, rateLimited = false) {
  super(message);
  this.status = status;
  this.rateLimited = rateLimited;
 }
}

const tokenFromEnv = env => env.GITHUB_TOKEN || env.GH_TOKEN || null;

// A read-only GitHub client over the documented REST API.
//
// `transport` exists so the tests can drive this without a network: it defaults to the
// platform's HTTP client and is otherwise never reached in this repository.
export function createClient(options = {}) {
 const env = options.env ?? process.env;
 const transport = options.transport ?? globalThis.fetch;
 const userAgent = options.userAgent ?? 'yn0-prospect-discovery (internal, read-only)';
 const base = options.base ?? API;

 if (typeof transport !== 'function') throw new GitHubError('no HTTP transport is available', 0);

 const request = async (pathname, {search = {}, accept = 'application/vnd.github+json', method = 'GET'} = {}) => {
  // The refusal is by name and first, so a future edit that tries to send something has
  // to delete this line rather than forget it.
  if (method !== 'GET') throw new GitHubError('this client is read-only; ' + method + ' is not available', 0);

  const url = new URL(base + pathname);
  for (const [key, value] of Object.entries(search)) url.searchParams.set(key, String(value));
  const token = tokenFromEnv(env);
  const headers = {accept, 'user-agent': userAgent, 'x-github-api-version': '2022-11-28'};
  if (token) headers.authorization = 'Bearer ' + token;

  const response = await transport(url.toString(), {method: 'GET', headers});
  const remaining = Number(response.headers?.get?.('x-ratelimit-remaining') ?? NaN);
  if (response.status === 403 || response.status === 429) {
   throw new GitHubError('GitHub refused the request (' + response.status + '); rate limit or permissions', response.status, true);
  }
  if (response.status === 404) throw new GitHubError('not found: ' + pathname, 404);
  if (!response.ok) throw new GitHubError('GitHub returned ' + response.status + ' for ' + pathname, response.status);
  const body = accept === 'application/vnd.github.raw' ? await response.text() : await response.json();
  return {body, remaining: Number.isFinite(remaining) ? remaining : null};
 };

 return {
  // One page of repository search results, normalized to the few public fields the
  // explorer uses. Nothing about a *person* is read: no owner email, no profile, no
  // followers, no contributor list.
  //
  // `sort` is the strategy's, not this module's. Omitting it is what GitHub documents as
  // "best match", which is the ranking the query actually asked for; passing `updated`
  // ranks by churn instead, and a client that decides that for every strategy is a client
  // that quietly changes what every strategy means.
  async searchRepositories(query, {page = 1, perPage = 30, sort = null, order = 'desc'} = {}) {
   const {body, remaining} = await request(ENDPOINTS.search, {
    search: {q: query, per_page: perPage, page, ...(sort ? {sort, order} : {})}
   });
   return {
    total: body.total_count ?? 0,
    incomplete: Boolean(body.incomplete_results),
    remaining,
    repositories: (body.items ?? []).map(item => ({
     fullName: item.full_name,
     owner: item.owner?.login ?? null,
     name: item.name,
     url: item.html_url,
     defaultBranch: item.default_branch ?? 'HEAD',
     description: item.description ?? null,
     topics: [...(item.topics ?? [])].sort(),
     archived: Boolean(item.archived),
     fork: Boolean(item.fork),
     hasIssues: Boolean(item.has_issues),
     pushedAt: item.pushed_at ?? null,
     size: item.size ?? 0,
     license: item.license?.spdx_id ?? null,
     homepage: item.homepage || null
    }))
   };
  },

  // The repository's file tree in one call. `truncated` is GitHub's own flag for a tree
  // too large to return; it is passed through rather than worked around, because a
  // partial tree is a partial inventory and the manifest should say so.
  async listTree(fullName, ref) {
   const {body, remaining} = await request(ENDPOINTS.tree(fullName) + encodeURIComponent(ref), {
    search: {recursive: 1}
   });
   return {
    remaining,
    truncated: Boolean(body.truncated),
    paths: (body.tree ?? [])
     .filter(item => item.type === 'blob')
     .map(item => ({path: item.path, size: item.size ?? 0}))
     .sort((a, b) => (a.path < b.path ? -1 : 1))
   };
  },

  // One file's raw text. Used only for paths the asset classifier already identified as
  // localization data.
  async getFile(fullName, ref, filePath) {
   const {body, remaining} = await request(
    ENDPOINTS.contents(fullName) + filePath.split('/').map(encodeURIComponent).join('/'),
    {search: {ref}, accept: 'application/vnd.github.raw'}
   );
   return {text: body, remaining};
  }
 };
}

// Whether a token is available, without revealing it. Reported in the run log so a short
// run has an obvious explanation.
export const hasCredential = (env = process.env) => Boolean(tokenFromEnv(env));
