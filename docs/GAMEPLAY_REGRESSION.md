# Audio and gameplay regression checks

VS AI keeps the existing Spotify song metadata, filters, difficulty and answer flow. Its audio resolver returns Deezer previews only, including when Spotify is configured. Missing previews are skipped using the existing track-selection flow. Spotify catalog requests remain necessary for the existing metadata/filter behavior; VS AI does not initialize the Spotify SDK or issue Spotify playback requests. The existing Deezer catalog fallback still handles unavailable Spotify catalogs.

Private matches keep the Spotify catalog, stored round metadata, Supabase match/answer flow and Spotify SDK provider. The arena now honors the `spotify-sdk` playback type already supplied by the dashboard, rather than waiting for a preview URL. Failed SDK initialization releases the failed player so retry can create a working device.

## Automated checks

```powershell
npm.cmd run check
npm.cmd run build
npm.cmd test
npm.cmd run test:deployment
npm.cmd run test:audio
npm.cmd run test:stats
```

The audio tests exercise provider resolution and the actual server API handler, including caching, concurrent requests, missing/mismatched previews, partial catalog failures and preservation of Spotify playback metadata after a VS AI request. They do not use developer credentials or live services.

The browser suite uses the production App, components, game hooks and database adapter. It supplies local Spotify, media, authentication, database and realtime fixtures. The fixture database emulates RPC responses; it does not execute the deployed SQL or verify a live Supabase instance. The suite exposes game state for assertions through a served copy of App.js without editing the source file.

Install optional browser tooling outside the project dependencies and run with an installed Chrome browser:

```powershell
npm.cmd install --prefix .tmp-browser-test --no-package-lock --no-save playwright
$env:MUSYNC_PLAYWRIGHT = '.tmp-browser-test/node_modules/playwright/index.mjs'
npm.cmd run test:browser
```

Set `MUSYNC_BROWSER=msedge` to use Edge. The React CDN requires network access. On machines that use a trusted corporate certificate, Node 24 can use the system trust store with `NODE_OPTIONS=--use-system-ca`.

## Verified on 2026-09-06

- Player/Score labels and long player names stay separated at 320, 375, 600, 768, 820, 1024, 1100, 1280, 1440 and 1920 pixels.
- VS AI completes 10 rounds, including correct, incorrect and unanswered rounds, answer locking, existing pop-up reveals, unchanged points calculation and final results. No Spotify SDK, eligibility, playback-token or playback API calls occur in that game.
- VS AI starts when the Spotify catalog reports a quota error, using its existing fallback and Deezer audio.
- Two browser contexts create/join a private lobby, mark ready, retry a failed Spotify SDK initialization, start one match, receive the same 10 Spotify tracks, submit answers, receive scores/reveals and finish. Each context sends 10 Spotify play requests and zero Deezer requests. Only the host advances rounds.
- Classic loads a Spotify song, starts playback, accepts a correct answer and shows the scored reveal without Deezer requests.
- Existing syntax/import, build, selection and deployment/OAuth/session tests pass.

A separate live check resolved a Deezer track with Spotify configured, fetched preview bytes through the production audio proxy (including a Range request), and confirmed Chrome decoded the MP3 and advanced playback time. Live Spotify Premium playback, real Supabase realtime/SQL, mobile-device autoplay and deployed-account permissions have not been verified by these fixture tests.

The Spotify player handoff follows the SDK's [device readiness contract](https://developer.spotify.com/documentation/web-playback-sdk/reference).

## Dynamic Classic statistics

Classic starts at round 1 with zero score, streak, accuracy and completed rounds. Earned statistics are persisted together under `musync-classic-stats-v1`; the old separate counters containing seeded demo values are no longer used. Settings and profile preferences retain their existing storage keys.

Correct answers update the score using the existing formula. Incorrect guesses still allow retries and count toward guess accuracy. Completing or skipping a song counts one played round; loading the next song advances the displayed round. An unanswered skip/timeout counts as a miss. Best streak records the actual highest streak, even after a later miss. Statistics and Profile use the same totals as the side panel.

`npm.cmd run test:stats` covers initialization, duplicate events, correct/incorrect answers, retries, skipped/timed-out rounds, best streak and persistence. Run the focused browser check with `npm.cmd run test:browser -- --classic-only` using the optional setup above.


## Startup, playback, transitions, and category regression fixes

VS AI initially requests one catalog page, resolves at most three preview candidates concurrently, and starts as soon as one succeeds. Preview requests have deadlines and share pending/completed resolutions. Match generations invalidate late catalog and audio results when a player leaves or changes screens. Round advance is guarded against duplicate calls, and the dashboard renders loading and retry feedback explicitly. Returning from AI results to friends selects the online transport and clears the AI roster; the shortcut into practice is consumed once.

Classic prepares the existing authenticated Spotify device, calls activateElement from the Play gesture, and waits for the SDK's playing state before starting its clip timer. Play requests include the existing stage position. Autoplay failures remain actionable through Play. OAuth session headers, server-side token refresh and the existing playback-token reuse are retained. No new token store was introduced. The gesture requirement follows the [Spotify SDK reference](https://developer.spotify.com/documentation/web-playback-sdk/reference).

Song origin is resolved from raw Spotify artist IDs before track normalization. OPM results require an OPM/Pinoy/Filipino/Philippine/Tagalog genre signal from a credited artist. International results require known artist genres and exclude those local signals. Unknown origins are omitted from either category; unavailable metadata is not evidence of international origin. These checks also apply after search fallback, before result caching and random selection. All artist batches are resolved. Unfiltered multiplayer requests preserve their existing Any origin behavior. This classification depends on Spotify's artist metadata; missing or incorrect provider metadata cannot establish geographical origin independently.

Carousel arrows apply the displayed selection, and late Classic next-round requests cannot overwrite a newer filter selection. Album, year, genre, difficulty, popularity, facts and the Spotify link are behind View More Details. Expanded answers scroll within the viewport, and hamburger navigation stays fixed at the top during page scrolling.

Additional automated coverage:

- npm run test:origin: mixed provider results, collaborations, unknown metadata, aliases, category-specific caches, query fallback, artist batches and transient metadata failures.
- npm run test:browser: completed AI to private lobby without reload, cancellation during startup, slow/missing preview candidates, Spotify activation and token request count, category carousel changes, popup sizes down to 320px and mobile menu position after scrolling.

Browser playback checks use an SDK fixture that requires gesture activation and emits player state changes. Actual Premium audio, account permissions and physical mobile browser playback still require live-account verification.
