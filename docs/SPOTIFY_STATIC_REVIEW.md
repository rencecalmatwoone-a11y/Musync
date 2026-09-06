# Classic Spotify request/cache review

This review covers the Spotify optimizations following the earlier gameplay changes. Verification for this change was **static source inspection and syntax-only parsing**. No application startup, test suite, game session, consecutive rounds, browser run, or live API request was performed. Earlier gameplay test reports do not validate this change at runtime.

## Finding

`Token cache hit user` denotes a read of an existing access token, not a refresh, cache allocation, or quota failure. The supplied lines show successful HTTP 200 responses and do not establish actual quota exhaustion. There is no token-cache capacity limit in the reviewed implementation.

The reviewed sources did contain unnecessary request paths:

- `/api/spotify/status` fetched `/v1/me` for the account display, while playback eligibility independently fetched the same endpoint.
- The browser fetched `/api/spotify/playback-token` on every playback command and SDK token callback, despite retaining a token without using its expiry.
- A playback 401 retried token retrieval without identifying the rejected token. The backend could return that same, nominally unexpired token again.
- Backend 401 handling rewrote the stored token expiry to zero and cleared the unrelated client-credentials cache, allowing late concurrent 401 responses to invalidate an already refreshed token.
- Classic's playback effect paused both during cleanup and in its non-playing branch. Each play also transferred the same device again.
- A transient playback error could cause a connected player to be torn down and initialized again.
- Classic fetched up to 120 catalog tracks through 12 ten-track requests. Its five-minute browser cache could expire during a game, causing another complete catalog load. A later-page failure discarded earlier usable results.
- OAuth query cleanup could remove the session/login marker before the relevant React effects used it.

## Reviewed flow after the changes

| Stage | Control flow and cache behavior |
| --- | --- |
| Login | Existing OAuth state validation and code exchange remain. The client captures the returned session before React effects clean up the URL; Classic retains the login/play intent in module state. |
| Status | The account control and multiplayer dashboard share a session-keyed status request/cache for 30 seconds. |
| Account/eligibility | Both server routes use `getSpotifyAccount`. Concurrent callers share one request per session. Successful `/v1/me` results are reused for five minutes within the server instance; account-cache size is capped at 200. Browser eligibility calls are also shared and cached for 60 seconds. |
| Token retrieval | A valid token is returned without refreshing or writing the stored session. The playback-token endpoint also supplies expiry, allowing browser reuse with a 30-second safety margin. SDK callbacks and HTTP playback commands use that same browser cache. |
| Expiry | Near-expiry tokens refresh through a per-session shared request. The existing session ID is updated after successful refresh; no new login/session entry is created. Client-credentials expiry follows the returned lifetime instead of a fixed lifetime. |
| Invalid token | A playback 401 supplies the rejected token in an Authorization header to the session-bound token endpoint. The server refreshes only if the stored token still matches it; an already replaced token is reused. Each API operation has one authentication retry. SDK authentication errors identify the token actually supplied to that SDK instance. |
| Catalog | Only Classic opts into a 30-track pool, reuse beyond the normal five-minute TTL, and retaining usable earlier pages after a later-page error. VS AI/private-match catalog defaults remain at 120 tracks with the existing TTL and failure behavior. Filter/session keys isolate pools. |
| Playback | Concurrent matching play requests are shared; play/pause requests are ordered and duplicate pauses coalesce. Classic alone skips repeated device transfers after a successful transfer/play. A healthy connected SDK player remains reusable after transient playback failures. |
| Classic initialization | No authentication is initiated by the Play control while a song is missing/loading. Discarded playback effects do not issue a play request. The clip clock starts after playback reports success and stops if startup fails. Answer validation and point calculations are unchanged. |
| Logout | Client credential/status/catalog caches are cleared. Generation checks prevent stale browser initialization results from repopulating playback state. Same-instance refresh cancellation prevents a pending refresh from restoring a logged-out session. |

The first Classic catalog load now makes at most three ten-track page requests rather than twelve, excluding any server-side fallback/authentication retry. This is a code-derived bound, not a measured live result. Further rounds reuse the loaded pool for the same filters in that browser page. The tradeoff is a smaller initial song pool; a reload or new filter combination can fetch fresh metadata.

## Failure handling reviewed

- Valid token/cache hits do not call the Accounts token endpoint or modify the stored token entry. Reuse logging is opt-in with `SPOTIFY_DEBUG=1` and explicitly labels reads as reuse.
- Transient refresh failures retain refresh credentials. Confirmed `invalid_grant`, missing refresh credentials when needed, or repeated account authentication failure lead back to login.
- Token, eligibility, initialization and playback requests have bounded waits or shared in-flight promises. Short token-failure caching prevents repeated SDK callbacks from repeatedly submitting the same failed retrieval.
- HTTP 429 responses preserve Retry-After. Playback retries observe a cooldown; the server does not sleep beyond its bounded retry delay for long Retry-After values.
- Accounts-token cooldown and Web API cooldown are separate. A Web API quota error does not by itself invalidate tokens or prevent a cached-token read.
- Direct playback quota errors are distinguished from Premium-account errors. A genuine provider quota restriction cannot be bypassed by token caching; retry remains subject to the cooldown.

## Scope and limits

This change does not edit VS AI audio resolution, multiplayer lobby/game hooks, Supabase match/answer operations, answer components, scoring formulas, or Classic statistics. Shared Spotify helpers now reuse credentials and requests; the private-match dashboard only switches its status read to the shared helper. Classic-specific catalog/device-transfer options are opt-in at its call sites.

The control flow supports continuing playback after successful login and reusing an initialized device/token without repeated authentication. That is a static assessment, **not runtime confirmation**.

Persistent Spotify sessions still use the existing session store. In-flight refresh deduplication, account caching and cancellation are per server process; browser caching is per page/tab. Cold serverless instances may each request an account profile, and simultaneous expired-token refreshes across different instances are not protected by a distributed lock. This review does not establish deployment-wide request counts, actual quota consumption, live permissions, or runtime playback reliability.
