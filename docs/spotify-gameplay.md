# Logged-in Spotify gameplay

Classic uses the authenticated Spotify catalog. OPM / Local favors popular
songs from 2000–2029 across genres, with popularity and artist diversity weighting
instead of uniform sampling. Its Era and Genre controls are fixed. OPM searches
resolve the song/artist references in `server/services/opmCatalog.js` against
Spotify's Philippine-market catalog. Each result must match the reference title
and artist, fall within 2000–2029, and have no playability restriction. Missing
recordings are skipped; broad genre searches cannot refill this pool. Artist
order varies by session and visits each artist before another song by that artist.
Popularity is optional because the reference list already identifies the hits.
International retains the selected era and genre in Spotify's search query.
Era uses the album release date reported by Spotify; it does not establish the
original release year of a reissue. Classic uses Spotify's genre-filtered track
results directly; it makes no extra artist requests, which could delay or reject
every playable result. Known OPM artist names and aliases are excluded from
International. Origin classification is best effort, not verified nationality.
Song details show the selected search genre, or Unknown for an unfiltered search.

Local development uses `npm run dev` with Node's watch mode so backend edits
restart the server. A server launched with `npm start` must be restarted after
backend changes; refreshing the page alone only reloads browser code.

Pools are isolated by Spotify session and filters. Classic starts with a small
page, randomly selects songs with popularity and artist diversity weighting,
and remembers played IDs across filter changes. It fetches another page in
the background when three unplayed songs remain. OPM resolves four references
per page with at most two searches in flight, caches results per session, and
passes exact cursors through the client and API. Other searches follow Spotify's
raw result cursor, so filtered empty pages do not end the search. Each foreground
selection scans at most five pages; an incomplete search reports that more
results remain, and the visible Retry songs button continues from that cursor.
Songs can repeat after a matching catalog is exhausted.
Expired pools are refreshed; they are not cached indefinitely.

Play activates the Spotify SDK element synchronously in the click handler,
before asynchronous token and device requests. Classic starts its clip timer
only after the SDK reports the requested track playing. Same-track replays also
check current SDK state when no event arrives. Pause targets Musync's device;
leaving the clip stops playback. Browser autoplay blocks remain retryable with
Play. An eligible Spotify Premium account and playback permissions are required.

Device registration has a 30-second foreground wait. A timeout keeps the
connecting SDK player alive so a late ready event or another Play click can
use the same activated device. SDK errors surface immediately even if connect
is pending; Classic Play refreshes an SDK-rejected token once before retrying.

Quota and rate-limit failures retain their retry deadline. Classic retries
after the server cooldown, including when advancing from a reveal, without
requiring logout. The server probes again after its five-minute quota cooldown;
this is not a claim that Spotify's external quota resets every five minutes.
Login/permission errors are not automatically retried. Logged-in VS sessions
do not substitute guest featured-artist or hardcoded song pools on failure.

Regression coverage: `npm run test:spotify`, `npm run test:origin`,
`npm run test:classic`, `npm run test:audio`, `npm test`, and `npm run check`.
Provider tests use mocked responses and clocks, so they do not consume live
Spotify quota. Live playback still needs verification after Spotify is available.
`node scripts/modes.browser.mjs --classic-spotify-only` exercises the actual
Classic UI with a simulated Spotify SDK that blocks playback until activated
by a user click, then verifies replay and pagination beyond the first OPM page.

Spotify search pagination and supported fields:
https://developer.spotify.com/documentation/web-api/reference/search

Browser audio activation:
https://developer.spotify.com/documentation/web-playback-sdk/reference#spotifyplayeractivateelement
