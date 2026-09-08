const triviaCache = new Map()

const KNOWN_TRIVIA = new Map([
  ['queen|bohemian rhapsody', '"Bohemian Rhapsody" was recorded in sections and famously layers Freddie Mercury\'s vocals into a choir-like operatic passage.'],
  ['the white stripes|seven nation army', 'The instantly recognizable bass-like riff in "Seven Nation Army" was created by Jack White using a pitch-shifted guitar.'],
])

function normalize(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function cacheKey(track) {
  return `${normalize(track?.artist)}|${normalize(track?.title)}`
}

function songTitle(value) {
  return normalize(value).replace(/\s*\((?:feat\.?|ft\.?|with)\s+[^)]*\)/g, '')
    .replace(/\s+-\s+(?:\d{4}\s+)?(?:remaster.*|radio edit|single version)$/i, '').trim()
}

function wikipediaSearchUrl(track) {
  const query = `${songTitle(track.title)} ${track.artist} song`
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
  const title = songTitle(track.title)
  const pageTitle = normalize(page?.title)
  return title && (pageTitle === title || pageTitle.startsWith(`${title} (`))
}

// Require a concrete anecdote, not release metadata, genre, or artist biography.
function selectTrivia(extract, track) {
  const paragraphs = extract.split(/\n+/).filter((line) => !/^\s*=/.test(line))
  const candidates = []
  const title = songTitle(track.title)
  for (const paragraph of paragraphs) {
    const sentences = paragraph.replace(/\[\d+\]/g, '').match(/[^.!?]+(?:[.!?]+["”’']*(?=\s|$)|$)/g) || []
    for (const raw of sentences) {
      const sentence = raw.replace(/\s+/g, ' ').trim()
      if (sentence.length < 45 || sentence.length > 420) continue
      const text = normalize(sentence)
      if (!text.includes(title) && !/\b(?:the|this) (?:song|track|single|recording|music video)\b/.test(text)) continue
      if (/\b(?:is|was) (?:a|an) (?:\S+ ){0,4}(?:song|single) by\b/.test(text)) continue
      let score = 0
      if (/\b(?:inspired by|inspiration|based on|originally (?:written|intended)|written for|came up with)\b/.test(text)) score += 5
      if (/\b(?:samples?|sampled|interpolates?|interpolation|pitch-shifted|backwards|backward|improvised)\b/.test(text)) score += 5
      if (/\b(?:recorded (?:in|at|using|with)|written in|one take|single take|demo|accidentally)\b/.test(text)) score += 4
      if (/\b(?:first (?:song|single|track) to|broke (?:the|a) record|banned|initially rejected)\b/.test(text)) score += 3
      if (score) candidates.push({ sentence, score })
    }
  }
  return candidates.sort((a, b) => b.score - a.score)[0]?.sentence || ''
}

async function fetchWikipediaTrivia(track) {
  const response = await fetch(wikipediaSearchUrl(track), { signal: AbortSignal.timeout(3500) })
  if (!response.ok) return ''
  const data = await response.json().catch(() => ({}))
  const matches = (Array.isArray(data?.query?.search) ? data.query.search : [])
    .filter((candidate) => likelySongPage(candidate, track))
  if (!matches.length) return ''
  // Full extracts are limited to one article per request.
  const pages = await Promise.all(matches.map(async (match) => {
    try {
      const params = new URLSearchParams({
        action: 'query', prop: 'extracts', explaintext: '1',
        titles: match.title, format: 'json', origin: '*',
      })
      const articleResponse = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, { signal: AbortSignal.timeout(3500) })
      if (!articleResponse.ok) return null
      const articles = await articleResponse.json()
      return Object.values(articles?.query?.pages || {}).find((page) => page.title === match.title)
    } catch {
      return null
    }
  }))
  for (const page of pages) {
    const extract = String(page?.extract || '')
    const introduction = normalize(extract.split(/\n\s*\n|\n\s*==/)[0])
    // A title match alone can select another artist's song with the same name.
    const artist = normalize(track.artist)
    if (!introduction.includes(artist) || !/\b(?:song|single)\b/.test(introduction)) continue
    const trivia = selectTrivia(extract, track)
    if (trivia) return trivia
  }
  return ''
}

export async function fetchTrackTrivia(track) {
  const key = cacheKey(track)
  if (!normalize(track?.title) || !normalize(track?.artist)) return ''
  if (KNOWN_TRIVIA.has(key)) return KNOWN_TRIVIA.get(key)
  if (triviaCache.has(key)) return triviaCache.get(key)

  const request = fetchWikipediaTrivia(track).catch(() => '')
  triviaCache.set(key, request)
  return request
}
