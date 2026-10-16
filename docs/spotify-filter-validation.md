# Connected Spotify International filters

Spotify artist responses can omit the deprecated `genres` field while returning
HTTP 200. Requiring that field for every artist discarded otherwise playable
search results, including era-only results. Earlier fixtures always provided it.

The service now distinguishes omitted metadata from an explicitly empty genre
list and from failed requests. When the field is omitted, the original Spotify
genre-filtered search supplies genre evidence (`genreSource: spotify-search`).
Available artist genres still undergo genre and OPM checks. Explicitly unknown
artists and failed lookups do not gain this fallback. A classified artist's
collaboration can survive an unclassified featured artist. Genre metadata expires
after five minutes so omitted fields are not cached for the process lifetime.

Era and playability checks remain mandatory. International requires every
credited artist to match the positive references in `internationalCatalog.js`,
derived from the existing International catalogs plus older-era/genre references.
Known OPM artists and OPM genre tags take precedence. Unknown artists, including
unknown collaborators and artists with generic pop tags, remain excluded rather
than being assumed International. This deliberately limits catalog coverage
until new artists are classified. Era means Spotify's
album release date, which may differ for reissues.

R&B uses `genre:"r&b"`; the previous `r-n-b` genre-seed spelling produced
unrelated catalog results. Search is never retried without the selected filters.
Hip-Hop uses `genre:hiphop`, verified against the live search endpoint; the
hyphenated genre-seed spelling did not return the expected mainstream catalog.

## Reproduction and validation

- `npm run test:spotify`: missing-field combinations across all genres and eras,
  existing wrong-genre/origin/year restrictions, pagination, sessions and playback.
- `node --test scripts/*.test.mjs`: full automated regression suite.
- `node --use-system-ca scripts/classic-filters.browser.mjs`: real app/client/HTTP
  flow with simulated Spotify and SDK responses.
- In PowerShell, set `$env:MUSYNC_SPOTIFY_OMIT_GENRES='1'` before the browser test
  to exercise the omitted-field response; remove that variable afterward.
- `node --use-system-ca --env-file=.env scripts/spotify-filters.live.mjs`: opt-in
  real Spotify catalog checks for 23 selections, using app credentials. Prints
  catalog metadata only. This does not verify a connected user's market or audio.

Spotify documents the [artist genres field as deprecated](https://developer.spotify.com/documentation/web-api/reference/get-an-artist)
and supports [genre and year search filters](https://developer.spotify.com/documentation/web-api/reference/search).
