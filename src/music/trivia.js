const triviaCache = new Map()

const KNOWN_TRIVIA = new Map([
  ['miguel|sure thing', 'Miguel wrote "Sure Thing" before his debut album was released, blending late-90s hip-hop rhythms with classic soul harmonies.'],
  ['drake|one dance', '"One Dance" became Drake\'s first UK number-one single and features Nigerian artist Wizkid and British singer Kyla.'],
  ['tyler, the creator|see you again (feat. kali uchis)', 'Tyler, The Creator wrote "See You Again" as a dreamy love song, with Kali Uchis adding the distinctive duet vocals.'],
  ['queen|bohemian rhapsody', '"Bohemian Rhapsody" was recorded in sections and famously layers Freddie Mercury\'s vocals into a choir-like operatic passage.'],
  ['the white stripes|seven nation army', 'The instantly recognizable bass-like riff in "Seven Nation Army" was created by Jack White using a pitch-shifted guitar.'],
  ['outkast|hey ya!', 'The repeated call-and-response in "Hey Ya!" was designed to make the song feel like a live audience singalong.'],
  ['daft punk|get lucky', 'Daft Punk recorded "Get Lucky" with Nile Rodgers and Pharrell Williams, building the track around a live funk-guitar performance.'],
  ['the weeknd|blinding lights', 'The Weeknd described "Blinding Lights" as being about wanting to see someone while driving through a city at night.'],
])

function normalize(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function cacheKey(track) {
  return `${normalize(track?.artist)}|${normalize(track?.title)}`
}

function wikipediaSearchUrl(track) {
  const query = `${track.title} ${track.artist} song`
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    srlimit: '5',
    format: 'json',
    origin: '*',
  })
  return `https://en.wikipedia.org/w/api.php?${params}`
}

function likelySongPage(page, track) {
  const title = normalize(track.title)
  const pageTitle = normalize(page?.title)
  return title && (pageTitle === title || pageTitle.includes(title))
}

async function fetchWikipediaTrivia(track) {
  const response = await fetch(wikipediaSearchUrl(track), { signal: AbortSignal.timeout(3500) })
  if (!response.ok) return ''
  const data = await response.json().catch(() => ({}))
  const page = (Array.isArray(data?.query?.search) ? data.query.search : [])
    .find((candidate) => likelySongPage(candidate, track))
  if (!page?.title) return ''

  const summaryResponse = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(page.title)}`, { signal: AbortSignal.timeout(3500) })
  if (!summaryResponse.ok) return ''
  const summary = await summaryResponse.json().catch(() => ({}))
  const extract = String(summary?.extract || '').replace(/\s+/g, ' ').trim()
  if (!extract) return ''
  const sentence = extract.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() || extract
  return sentence.length > 280 ? `${sentence.slice(0, 277).trimEnd()}...` : sentence
}

export async function fetchTrackTrivia(track) {
  const key = cacheKey(track)
  if (!key || key === '|') return ''
  if (KNOWN_TRIVIA.has(key)) return KNOWN_TRIVIA.get(key)
  if (triviaCache.has(key)) return triviaCache.get(key)

  const request = fetchWikipediaTrivia(track).catch(() => '')
  triviaCache.set(key, request)
  return request
}
