// Fake data for music app prototype.
// Songs, playlists, artists, taste profiles.

const PROFILES = [
  { id: "main",  name: "Main",         desc: "The catch-all. Everything else lives here.",  hue: 28,  songs: 412, glyph: "◐" },
  { id: "jp",    name: "Japanese",     desc: "City pop, shibuya-kei, J-jazz.",               hue: 8,   songs: 87,  glyph: "緑" },
  { id: "chill", name: "Chill Beats",  desc: "Lo-fi, downtempo, after-midnight tape.",       hue: 220, songs: 134, glyph: "◌" },
  { id: "heavy", name: "Heavy",        desc: "Post-metal, sludge, the loud half.",           hue: 0,   songs: 56,  glyph: "▲" },
  { id: "folk",  name: "Folk",         desc: "Acoustic, slowcore, wood & string.",           hue: 60,  songs: 78,  glyph: "✦" },
];

const ARTISTS = [
  { id: "a1", name: "Maren Tashi",      followed: true,  newRelease: true,  songs: 12, photo: { kind: "geo", seed: 1 } },
  { id: "a2", name: "Hollow Coast",     followed: true,  newRelease: false, songs: 23, photo: { kind: "grad", seed: 2 } },
  { id: "a3", name: "Junichi Sora",     followed: true,  newRelease: false, songs: 19, photo: { kind: "type", seed: 3 } },
  { id: "a4", name: "Bel & the Quiet",  followed: false, newRelease: false, songs: 8,  photo: { kind: "geo", seed: 4 } },
  { id: "a5", name: "Northbound",       followed: true,  newRelease: true,  songs: 31, photo: { kind: "grad", seed: 5 } },
  { id: "a6", name: "Ami Kurosawa",     followed: true,  newRelease: false, songs: 14, photo: { kind: "type", seed: 6 } },
  { id: "a7", name: "Lowlight Co.",     followed: false, newRelease: false, songs: 9,  photo: { kind: "geo", seed: 7 } },
  { id: "a8", name: "Eider Pass",       followed: true,  newRelease: false, songs: 16, photo: { kind: "grad", seed: 8 } },
  { id: "a9", name: "Yui & Forrest",    followed: false, newRelease: false, songs: 11, photo: { kind: "type", seed: 9 } },
  { id: "a10", name: "Mara Vint",       followed: true,  newRelease: false, songs: 22, photo: { kind: "grad", seed: 10 } },
];

const ALBUMS = [
  { id: "al1", title: "Slow Country", artist: "Maren Tashi",    year: 2025, songs: 9, cover: { kind: "grad", seed: 11 } },
  { id: "al2", title: "Telephone Park", artist: "Hollow Coast", year: 2024, songs: 11, cover: { kind: "type", seed: 12 } },
  { id: "al3", title: "Aoi Hour",     artist: "Junichi Sora",   year: 2024, songs: 8, cover: { kind: "geo", seed: 13 } },
  { id: "al4", title: "Eastern Wind", artist: "Mara Vint",      year: 2023, songs: 10, cover: { kind: "grad", seed: 14 } },
  { id: "al5", title: "Floor Five",   artist: "Lowlight Co.",   year: 2025, songs: 7,  cover: { kind: "type", seed: 15 } },
];

// Song generator. Deterministic so things are stable.
const SONG_TITLES = [
  "Cassette Garden", "Marina Heights", "Field Notes for a Slow Sunday", "Quiet Constellations",
  "Returning", "Pale Iron", "Held Light", "Hours Like This", "Tape Loop 7",
  "Letterbox", "The Long Walk", "Coral & Stone", "Empty Highway",
  "Soft Decision", "Goldenrod", "Telephone Park", "Aoi Hour", "Birdwatcher",
  "Wood Stove", "Northbound", "Folded Map", "Rain on Tin", "Watershed",
  "Linen", "Citrus", "January Light", "Slow Country", "Heron",
  "Floor Five", "Drift", "Halfway Through", "Late Garden", "Tunnel Vision",
  "Ash & Saltwater", "Threshold", "Tideline", "Mistral", "Open Window",
  "Hi-Beam", "Pale Engine", "Old Sun", "Quiet Driver", "Veranda",
];

const ARTIST_POOL = [
  "Maren Tashi", "Hollow Coast", "Junichi Sora", "Bel & the Quiet", "Northbound",
  "Ami Kurosawa", "Lowlight Co.", "Eider Pass", "Yui & Forrest", "Mara Vint",
  "Sundial Press", "The Coast Method", "Halv & Holm", "Reiko Avenue", "Pine Era",
];

const COVER_KINDS = ["grad", "type", "geo"];

function mkSong(i, opts = {}) {
  const t = SONG_TITLES[i % SONG_TITLES.length];
  const a = opts.artist || ARTIST_POOL[(i * 7 + 3) % ARTIST_POOL.length];
  const dur = 120 + ((i * 47) % 220); // 2:00 – 5:40
  return {
    id: opts.id || `s${i}`,
    title: t,
    artist: a,
    album: opts.album || ALBUMS[(i * 3) % ALBUMS.length].title,
    duration: dur,
    cover: opts.cover || { kind: COVER_KINDS[i % 3], seed: (i * 13) % 97 },
    profile: opts.profile || PROFILES[i % PROFILES.length].id,
  };
}

const ALL_SONGS = Array.from({ length: 40 }, (_, i) => mkSong(i));

// Daily playlists
const DAILY_PLAYLISTS = [
  {
    id: "dp1",
    slot: "close",
    isDaily: true,
    title: "Close Match",
    subtitle: "Tunes that sit right inside your taste.",
    accent: "Like what you love.",
    duration: "32 min",
    songCount: 9,
    songs: Array.from({ length: 9 }, (_, i) => mkSong(i + 1)),
    cover: { kind: "grad", seed: 21 },
  },
  {
    id: "dp2",
    slot: "broader",
    isDaily: true,
    title: "Broader Taste",
    subtitle: "A few steps further from the center.",
    accent: "Stretch a little.",
    duration: "29 min",
    songCount: 8,
    songs: Array.from({ length: 8 }, (_, i) => mkSong(i + 9)),
    cover: { kind: "geo", seed: 22 },
  },
  {
    id: "dp3",
    slot: "genre",
    isDaily: true,
    title: "Ambient Folk",
    subtitle: "Today's new-genre detour.",
    accent: "Today: Ambient Folk",
    duration: "33 min",
    songCount: 10,
    songs: Array.from({ length: 10 }, (_, i) => mkSong(i + 17)),
    cover: { kind: "type", seed: 23 },
  },
  {
    id: "dp4",
    slot: "artist",
    isDaily: true,
    title: "Sundial Press",
    subtitle: "Today's introduction: one new artist.",
    accent: "Artist of the day",
    duration: "24 min",
    songCount: 6,
    songs: Array.from({ length: 6 }, (_, i) => mkSong(i + 27, { artist: "Sundial Press" })),
    cover: { kind: "grad", seed: 24 },
  },
];

// Custom user playlists
const CUSTOM_PLAYLISTS = [
  { id: "cp1", title: "Late Drive",       songs: 24, cover: { kind: "grad", seed: 31 } },
  { id: "cp2", title: "Morning Calm",     songs: 18, cover: { kind: "geo",  seed: 32 } },
  { id: "cp3", title: "Wood Floor Demos", songs: 11, cover: { kind: "type", seed: 33 } },
  { id: "cp4", title: "Wintering",        songs: 36, cover: { kind: "grad", seed: 34 } },
  { id: "cp5", title: "Letters from Home",songs: 14, cover: { kind: "geo",  seed: 35 } },
];

// 30-day history
const HISTORY = Array.from({ length: 12 }, (_, i) => {
  const date = new Date(2026, 4, 18 - i); // working backward from May 18, 2026
  const slots = ["Close Match", "Broader Taste", "New Genre", "Artist"];
  return {
    id: `h${i}`,
    date,
    items: slots.map((s, j) => ({
      title: s,
      subtitle: ["Close kin to your library", "A step outside", ["Ambient Folk","Krautrock","Slowcore","Shoegaze"][i%4], ARTIST_POOL[(i*3+j)%ARTIST_POOL.length]][j],
      cover: { kind: COVER_KINDS[(i + j) % 3], seed: i * 11 + j * 5 },
      kept: (i + j) % 3 !== 0,
    })),
  };
});

// Songs marked for deletion today
const DELETION_QUEUE = Array.from({ length: 6 }, (_, i) => mkSong(i + 35, { id: `del${i}` }));

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function relDate(d) {
  const today = new Date(2026, 4, 18);
  const days = Math.floor((today - d) / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

Object.assign(window, {
  PROFILES, ARTISTS, ALBUMS, ALL_SONGS,
  DAILY_PLAYLISTS, CUSTOM_PLAYLISTS, HISTORY, DELETION_QUEUE,
  SONG_TITLES, ARTIST_POOL,
  fmtTime, relDate, mkSong,
});
