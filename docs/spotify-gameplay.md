# Logged-in Spotify gameplay

Classic uses the authenticated Spotify catalog. Era and genre also apply when
Songs is OPM / Local. Era uses the album release date reported by Spotify; it
does not establish the original release year of a reissue. Genres and origin
are checked against artist metadata. Unknown metadata is excluded when it
cannot confirm a selected filter. A matching subgenre is shown in song details.

Pools are isolated by Spotify session and filters. Classic starts with a small
page, randomly selects songs with popularity and artist diversity weighting,
and remembers played IDs across filter changes. It fetches another page in
the background when three unplayed songs remain. Pagination follows Spotify's
raw result cursor, so filtered empty pages do not end the search. Each foreground
selection scans at most five pages; Retry songs continues from that cursor if
the filter is sparse. Songs can repeat after a matching catalog is exhausted.
Expired pools are refreshed; they are not cached indefinitely.

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

Spotify search pagination and supported fields:
https://developer.spotify.com/documentation/web-api/reference/search
