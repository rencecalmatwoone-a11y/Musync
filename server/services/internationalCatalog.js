import { GUEST_TRACKS } from './guestTrackList.js'
import { CLASSIC_GUEST_TRACKS } from './classicGuestTrackList.js'
import { popularTracks } from '../../src/data/popularTracks.js'

const normalize = (value) => String(value || '').normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

// Positive origin references, independent of genre. The existing International
// catalogs supply modern artists; these references cover older eras and genres.
const additionalArtists = [
  'Elvis Presley', 'Chuck Berry', 'Little Richard', 'Buddy Holly', 'Fats Domino',
  'Ray Charles', 'Sam Cooke', 'The Everly Brothers', 'The Platters', 'Paul Anka',
  'Frank Sinatra', 'Nat King Cole', 'Ella Fitzgerald', 'Louis Armstrong',
  'Johnny Cash', 'Hank Williams', 'Patsy Cline', 'Brenda Lee', 'Etta James',
  'The Beatles', 'The Rolling Stones', 'The Beach Boys', 'The Supremes',
  'The Temptations', 'Otis Redding', 'Aretha Franklin', 'Marvin Gaye',
  'Stevie Wonder', 'Bob Dylan', 'Simon & Garfunkel', 'Jimi Hendrix', 'The Doors',
  'Creedence Clearwater Revival', 'Led Zeppelin', 'Pink Floyd', 'Fleetwood Mac',
  'Elton John', 'David Bowie', 'Billy Joel', 'Bee Gees', 'Earth, Wind & Fire',
  'Donna Summer', 'Diana Ross', 'Carpenters', 'Dolly Parton', 'Kenny Rogers',
  'Willie Nelson', 'John Denver', 'George Strait', 'Garth Brooks', 'Shania Twain',
  'Brooks & Dunn', 'Alan Jackson', 'Tracy Lawrence', 'Toby Keith', 'Tim McGraw',
  'Faith Hill', 'Carrie Underwood', 'Luke Combs', 'Morgan Wallen', 'Zach Bryan',
  'Chris Stapleton', 'Kacey Musgraves', 'Lainey Wilson', 'Jelly Roll',
  'The Goo Goo Dolls', 'Goo Goo Dolls', 'blink-182', 'Foo Fighters', 'Pearl Jam',
  'Red Hot Chili Peppers', 'Soundgarden', 'Alice in Chains', 'Metallica',
  'AC/DC', 'Aerosmith', 'Journey', 'Toto', 'New Radicals', 'Ace of Base',
  'Nine Inch Nails', 'Portishead', 'Massive Attack', 'The Prodigy',
  'The Chemical Brothers', 'Fatboy Slim', 'Moby', 'Faithless', 'Depeche Mode',
  'New Order', 'Pet Shop Boys', 'Deee-Lite', 'Haddaway', 'Corona',
  '2Pac', 'The Notorious B.I.G.', 'Snoop Dogg', 'Dr. Dre', 'Nas', 'Jay-Z',
  'Wu-Tang Clan', 'A Tribe Called Quest', 'Public Enemy', 'Beastie Boys',
  'N.W.A.', 'Ice Cube', 'Lauryn Hill', 'Fugees', 'Missy Elliott', 'DMX',
  'Brandy', 'Monica', 'Bell Biv DeVoe', 'Boyz II Men', 'Mary J. Blige',
  'D Angelo', 'Erykah Badu', 'Aaliyah', 'Janet Jackson', 'Destinys Child',
  'Santana', 'Rob Thomas', 'Ricky Martin', 'Enrique Iglesias', 'Gloria Estefan',
  'Selena', 'Celia Cruz', 'Tito Puente', 'Héctor Lavoe', 'Willie Colón',
  'Rubén Blades', 'Juan Luis Guerra', 'Juanes', 'Maná', 'Bobby Pulido',
  'Los Ángeles Azules', 'Los Tigres del Norte', 'Vicente Fernández',
  'Luis Miguel', 'Marc Anthony', 'Daddy Yankee', 'Don Omar', 'Bad Bunny',
  'J Balvin', 'Karol G', 'Rauw Alejandro', 'Peso Pluma', 'Rosalía',
  'Swae Lee', 'H.E.R.', 'ROSE', 'Guns N Roses', "Guns N' Roses",
]
const names = new Set([
  ...GUEST_TRACKS, ...CLASSIC_GUEST_TRACKS, ...popularTracks,
].map(({ artist }) => normalize(artist)).concat(additionalArtists.map(normalize)))

export function hasInternationalArtists(track) {
  // An unknown collaborator may be local. Never infer origin from a pop/rock
  // genre, English title, Spotify market, or absence from the OPM reference list.
  return Boolean(track.artists?.length) && track.artists.every((artist) => names.has(normalize(artist.name)))
}
