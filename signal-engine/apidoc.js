/**
 * What this API is, answered by the API.
 *
 * Every route below already existed and worked; what was missing was any way
 * to find out. A register nobody can consume programmatically is a website,
 * and the whole claim here is that the record is checkable by somebody else.
 *
 * The list is data rather than prose so `test-api.js` can hold it against the
 * routes `api.js` actually handles: a documented route that does not exist and
 * a route nobody documented both fail there rather than in somebody's client.
 * Anything deliberately undocumented has to say so out loud in PRIVATE.
 */

/** Routes that exist and are deliberately not advertised, with the reason. */
export const PRIVATE = {
  "/api/tg": "the bot's own identity, read by the site to name it",
  "/api/tg/link": "binds a Telegram chat to a signed-in wallet; useless to anyone else",
  "/api/alpha/invite": "issues a single-use channel link to one wallet",
};

export const ROUTES = [
  { path: "/api", method: "GET", returns: "this index",
    note: "stable; new fields may be added, existing ones are not removed" },

  { path: "/api/register", method: "GET", returns: "array of calls, newest first",
    params: {
      verdict: "win | miss | open", chain: "chain name", dead: "1 to keep only dead calls",
      live: "1 to keep only calls still open", hours: "only calls fired in the last N hours",
      min_mc: "minimum entry market cap", min_vol: "minimum entry 1h volume",
      q: "substring of name, symbol or token address",
      sort: "peak | now (default: newest first)",
      limit: "1–200, default 50", offset: "default 0",
    },
    headers: { "x-total-count": "matches before limit/offset, so a client can page" },
    gated: "by tier — see latency below" },

  { path: "/api/call/:seq", method: "GET",
    returns: "one call with its full observed price series",
    note: "samples here are every observation, not the thinned series on the list route" },

  { path: "/api/stats", method: "GET", returns: "hit rate, median and best peak, dead and live counts",
    params: { days: "window in days, or all (default 7)" },
    note: "over every call in the window, misses included. Filters on /api/register never touch this" },

  { path: "/api/verify", method: "GET",
    returns: "whether the hash chain still verifies, its head, and whether it has been anchored",
    note: "ok:false means a row was changed or removed. anchored:false means the chain is "
        + "internally consistent and has never been published, so it is not independently verifiable" },

  { path: "/api/verify/:seq", method: "GET", returns: "a merkle proof for one call",
    note: "202 while that call is not yet covered by a published anchor" },

  { path: "/api/export.csv", method: "GET", returns: "the whole register as CSV",
    note: "every hashed field is present and an absent one is \\\\N, so the chain can be "
        + "recomputed from this file alone" },

  { path: "/api/triage", method: "GET",
    returns: "what the screener refused and the threshold it was refused against, per source",
    note: "public on purpose: a filter nobody can inspect is a claim, not a filter" },

  { path: "/api/analytics/reasons", method: "GET", returns: "hit rate and lift per firing reason" },
  { path: "/api/analytics/bands", method: "GET", returns: "hit rate per score band" },
  { path: "/api/analytics/chains", method: "GET", returns: "hit rate per chain" },
  { path: "/api/analytics/callers", method: "GET", returns: "the leaderboard, one desk today" },
  { path: "/api/analytics/simulate", method: "GET", returns: "what an exit rule would have returned",
    params: { exit: "2x | 1.5x | hold | trail (default 2x)", size: "stake per call, default 100" } },

  { path: "/api/keys", method: "GET", returns: "the collection's address, chain and mint selector" },
  { path: "/api/keys/state", method: "GET", returns: "phase, prices, supply, and the ETH/USD rate",
    params: { address: "optional; adds what this wallet minted and holds" },
    note: "usdPerEth is null when the rate could not be read — never a guess" },

  { path: "/api/alpha", method: "GET", returns: "the reject tape and the near misses",
    gated: "by keys held — a wallet below the rung gets a body with neither key in it" },
];

/**
 * The one thing an API consumer has to understand about this desk, answered
 * with the number actually in force rather than a claim about it: an anonymous
 * caller is on the public leg, and the public leg is the slowest tier.
 */
export const latency = delays => ({
  anonymous: `${delays[0]}s behind the desk`,
  authenticated: "sign in with the wallet holding a key; the tier drawn on that key sets the delay",
  tiers: { "III": `${delays[3]}s`, "II": `${delays[2]}s`, "I": `${delays[1]}s`, public: `${delays[0]}s` },
  note: delays[0] === 0
    ? "the public leg is open right now, so every caller sees a call the moment it fires"
    : "calls fired more recently than that are not in the response at all, rather than present and marked",
});

export const index = ({ delays, site = "nekara.xyz" }) => ({
  name: "Nekara register",
  site: `https://${site}`,
  what: "Every signal this desk fires, published with the conditions that triggered it and "
      + "tracked to win, miss or dead. Nothing is ever removed.",
  cors: "*",
  auth: "none for the routes below; a signed-in session only changes how recent the calls may be",
  latency: latency(delays),
  routes: ROUTES,
  undocumented: PRIVATE,
});
