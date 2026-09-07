# Classic public playback and scoring

Classic does not require a Spotify login, Spotify app credentials, or a user
access token. Spotify remains optional for authenticated features such as the
existing private-match player.

## Game flow

Settings select candidates from src/data/classicTracks.js: the existing public
popular-track metadata plus older, country and OPM entries. Origin, genre,
release era and difficulty are applied locally. OPM retains its existing rule
that genre and era controls are disabled. Empty filter combinations report no
matches rather than silently changing categories.

The selected candidate uses the existing resolveVSAudioPreview mechanism,
/api/vs-audio-preview, and /api/audio-preview proxy. These already resolve
public Deezer previews without an account. No new audio provider was added.
Missing previews are skipped with bounded attempts and the existing cache.
Public previews still require network access and provider availability.

Classic AudioPlayer uses the existing usePreviewAudio hook. Play is called in
the click gesture; the staged 0.5/2/8/15-second timer starts only after media
playback succeeds. Reveals continue the same preview. Answer suggestions search
the local catalog, so typing and opening song details do not query Spotify.

The optional account control can check the app's local Spotify session status;
Classic never waits for that status and makes no Spotify token, catalog,
artist, profile, eligibility, or player requests. VS AI and private-match
selection/playback rules are unchanged.

## Points

classicAvailablePoints is the single Classic award calculation:
(difficulty + 1) * 50 + current streak * 10. The pre-submit points label
recomputes on each render. The reducer calculates the award from its current
state when handling the guess and stores roundPoints together with the score.
SongReveal receives this actual award through props; it no longer hardcodes
150 or recalculates an earned award from the incremented streak. A wrong guess
resets the streak, skips award zero, and round advancement clears the prior
award. Reload migration preserves earned totals and clears transient awards.

Classic has no time, hint or extra multiplier penalty in its existing scoring
rules. Those rules were preserved. Shared battle reveals receive their recorded
submission points, including the existing time/difficulty bonus, without
changing battle scoring or answer behavior.

## Validation

npm run test:classic checks local filtering, public audio selection, missing
previews, next-track selection, local autocomplete, and score/award equality
across difficulties, streaks, wrong answers, skips and round changes.

npm run test:browser runs logged-out Classic with Spotify requests forbidden,
checks audio, answers, dynamic pop-up points, score persistence, round
progression, filters and responsive controls, and exercises the existing VS AI
and two-browser private-match scenarios. Its media/provider fixtures are
simulated; live public previews can additionally be checked with
scripts/classic-live.browser.mjs.

The live browser check passed with Spotify/Supabase credentials removed and a
fresh browser context: two public previews decoded and played, an answer earned
exactly the displayed points, and the next round loaded without Spotify API or
token requests. Live International and OPM preview downloads also returned
valid audio/mpeg responses. Live provider availability can vary by recording.

The mobile stats slide button remains hidden through 768px, with its saved
collapse/expand behavior retained at larger widths.
