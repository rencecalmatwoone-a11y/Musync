import { createHash } from 'node:crypto'

// Song/artist references supplied for Classic OPM. These are search seeds, not
// fabricated Spotify IDs or popularity scores. Spotify supplies the recordings.
const artists = [
  ['Cup of Joe', ['Multo', 'Tingin', 'Misteryoso']],
  ['BINI', ['Pantropiko', 'Salamin, Salamin', 'Karera', 'Lagi', 'Cherry On Top']],
  ['Dionela', ['Marilag', 'Sining']],
  ['Maki', ['Dilaw', 'kahel na langit']],
  ['Earl Agustin', ['Tibok', 'Pag-ibig ng Ikaw at Ako']],
  ['Amiel Sol', ['Sa Bawat Sandali', 'Ikaw Lang Patutunguhan']],
  ['TJ Monterde', ['Palagi']],
  ['SB19', ['MAPA', 'GENTO', 'Moonlight', 'DUNGKA!', 'Bazinga', 'WYAT']],
  ['ALAMAT', ['Maharani']],
  ['fitterkarma', ['Kalapastangan', 'Pag-Ibig ay Kanibalismo II']],
  ['Esremborak', ['Mahal Magmahal']],
  ['Jin DC', ['Totoong Tayo']],
  ['Kyle Raphael', ['Libu-Libong Buwan (Uuwian)']],
  ['nicole', ['Panaginip']],
  ['shirebound', ['Pahintulot'], ['Shirebound & Busking']],
  ['TONEEJAY', ['711']],
  ['Jolianne', ['Palayo Sa Mundo']],
  ['HELLMERRY', ['Summer Crush']],
  ['Denise Julia', ['B.A.D.']],
  ['Zack Tabudlo', ['Pano', 'Binibini', 'Habang Buhay', 'Nangangamba', 'Give Me Your Forever', 'Gusto']],
  ['Adie', ['Paraluman', 'Tahanan', 'Mahika', 'Kursunada']],
  ['Arthur Nery', ['Isa Lang', 'Pagsamo', 'Take All the Love', 'Higa']],
  ['Sunkissed Lola', ['Pasilyo', 'Paki Sabi']],
  ['Dilaw', ['Uhaw (Tayong Lahat)', 'Janice']],
  ['juan karlos', ['ERE', 'Buwan', 'Demonyo']],
  ['Lola Amour', ['Raining in Manila', 'Fallen']],
  ['IV OF SPADES', ['Mundo', 'Come Inside of My Heart', 'Captivated', 'Hey Barbara', 'Ilaw Sa Daan', 'Kabisado']],
  ['Ben&Ben', ['Leaves', 'Pagtingin', 'Kathang Isip', 'Sa Susunod na Habang Buhay', 'Paninindigan Kita', 'Araw-Araw', 'Maybe the Night', 'Ride Home']],
  ['December Avenue', ['Saksi Ang Langit', "Kung 'Di Rin Lang Ikaw", 'Sa Ngalan ng Pag-Ibig', 'Bulong', "Kahit 'Di Mo Alam", 'Huling Sandali', 'Dahan']],
  ['Moira Dela Torre', ['Ikaw at Ako', 'Paubaya', "Babalik Sa'yo", 'Patawad', 'Tagpuan', 'Malaya', 'Titibo-Tibo']],
  ['This Band', ['Kahit Ayaw Mo Na', 'Pano Maging Tayo']],
  ['The Juans', ['Hatid', 'Hindi Tayo Pwede']],
  ['UDD', ['Oo', 'Tadhana', 'Unti-Unti', 'Indak', 'Turn It Well'], ['Up Dharma Down']],
  ['I Belong to the Zoo', ['Sana', 'Balang Araw']],
  ['Munimuni', ['Bawat Piyesa', "Sa'yo", 'Kulayan Natin']],
  ['Ang Bandang Shirley', ['Umaapaw']],
  ['Rico Blanco', ['Your Universe', 'Antukin', 'Yugto', 'Wag Mong Aminin']],
  ['Skusta Clee', ['Zebbiana', 'Since Day One']],
  ['ALLMO$T', ['Dalaga', 'Miracle Nights']],
  ['Ex Battalion', ['Hayaan Mo Sila']],
  ['Because', ['Need You', 'Marlboro Black']],
  ['Gloc-9', ['Sirena', 'Simpleng Tao', 'Magda', 'Walang Natira', 'Upuan']],
  ['Abra', ['Gayuma', 'Diwata']],
  ['Shanti Dope', ['Nadarang']],
  ['Jireh Lim', ['Buko', 'Magkabilang Mundo']],
  ['Yeng Constantino', ['Chinito', 'Ikaw', 'Jeepney Love Story', 'Pag-Ibig', 'Hawak Kamay']],
  ['Bamboo', ['Noypi', 'Hallelujah', 'Tatsulok', 'Masaya', 'Much Has Been Said', 'Probinsyana']],
  ['Kamikazee', ['Narda', 'Martyr Nyebera', 'Chiksilog', 'Huling Sayaw', 'Halik']],
  ['Hale', ['The Day You Said Goodnight', 'Blue Sky', 'Kung Wala Ka', 'Broken Sonnet', 'Kahit Pa']],
  ['Sponge Cola', ['Jeepney', 'Gemini', 'Bitiw', 'Tuliro', 'KLSP', 'Pasubali']],
  ['Sugarfree', ['Hari ng Sablay', 'Burnout', 'Mariposa', 'Prom', 'Tulog Na', 'Makita Kang Muli', 'Wag Ka Nang Umiyak']],
  ['Parokya ni Edgar', ['Your Song', 'Gitara', "This Guy's in Love With You Pare", 'Alumni Homecoming', 'Bagsakan', 'Ordertaker', 'The Yes Yes Show']],
  ['Callalily', ['Stars', 'Magbalik', 'Sanctuary', 'Pasan', 'Susundan']],
  ['6cyclemind', ['Prinsesa', 'Sandalan', 'Biglaan', 'Sige', 'Upside Down']],
  ['The Itchyworms', ['Beer', 'Akin Ka Na Lang', 'Love Team', 'Di Na Muli', 'Salapi'], ['Itchyworms']],
  ['Moonstar88', ['Migraine', 'Torete', 'Sulat']],
  ['Kitchie Nadal', ['Same Ground', 'Huwag Na Huwag Mong Sasabihin', 'Bulong']],
  ['Session Road', ['Cool Off', 'Suntok sa Buwan']],
  ['Cueshé', ['Ulan', 'Stay', 'Borrowed Time', 'Sorry', 'Back to Me']],
  ['South Border', ['Rainbow', 'Ikaw Nga']],
  ['Rivermaya', ["You'll Be Safe Here", 'Liwanag sa Dilim', 'Umaaraw, Umuulan', 'Balisong']],
  ['Orange & Lemons', ['Heaven Knows (This Angel Has Flown)', 'Hanggang Kailan', 'Pinoy Ako']],
]

export function opmReferenceOrder(sessionId) {
  const rank = (value) => createHash('sha256').update(`${sessionId}:${value}`).digest('hex')
  const groups = artists.map(([artist, titles, aliases = []]) => ({
    artist,
    songs: titles.map((title) => ({ title, artist, artistNames: [artist, ...aliases] }))
      .sort((a, b) => rank(`${artist}:${a.title}`).localeCompare(rank(`${artist}:${b.title}`))),
  })).sort((a, b) => rank(a.artist).localeCompare(rank(b.artist)))
  // Visit every artist before taking a second song by the same artist.
  return Array.from({ length: Math.max(...groups.map((group) => group.songs.length)) }, (_, index) =>
    groups.flatMap((group) => group.songs[index] ? [group.songs[index]] : [])).flat()
}

const normalize = (value) => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '')
const titleKey = (value) => normalize(String(value || '')
  .replace(/\s*\((?:feat\.?|ft\.?|with)\s+[^)]*\)/gi, '')
  .replace(/\s+-\s+(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?$/i, ''))

export function matchesOpmReference(track, reference) {
  return titleKey(track.name) === titleKey(reference.title)
    && track.artists?.some((artist) => reference.artistNames.some((name) => normalize(name) === normalize(artist.name)))
}
