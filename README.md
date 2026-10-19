# DnD Radio

A synced background-music radio for tabletop sessions. Pick a setting
(Medieval, Tavern, Celtic, East Asian, Tropical, Dungeon, Royal court) and the
station's songs are re-voiced for it, with colours and an animation to match.
Everyone tuned in hears the same song at the same moment.

## Run

```sh
npm install
npm run dev
```

```sh
npm test            # logic tests (Node's built-in runner, Node 22+)
npm run build       # type-check + production build
npm run gen:midi    # regenerate the demo MIDI files in public/midi
```

## Deploy

Pushing to `main` builds and deploys to GitHub Pages via
`.github/workflows/deploy.yml` (it runs the tests first). In the repo settings,
set **Pages → Source** to **GitHub Actions**. The build uses a relative base,
so it works under `https://<user>.github.io/dnd-radio/`.

## The radio

- **Playlist**: the stock songs in `public/midi/index.json` (entries with
  `"radio": false` stay out of rotation) loop forever from a fixed start,
  `EPOCH_MS` in `src/radio/schedule.ts`, with a 2 s gap between songs. Anyone
  who knows the UTC time can work out what's playing and how far in, so no
  server is needed.
- **Clock** (`src/radio/clock.ts`): device clocks are often seconds off, so the
  page asks `time.akamai.com` for the time a few times and keeps the fastest
  answer (NTP-style), then runs on `performance.now()`. If that's blocked it
  falls back to the page's own `Date` header (about ±0.5 s), then to the device
  clock.
- **Scheduling** (`src/music/engine.ts`): notes are scheduled on the Web Audio
  clock, compensating for the device's output latency, and the start position
  is decided only after instruments have loaded. The next song is scheduled 3 s
  ahead so transitions land on the boundary. Changing the setting, scale or
  instruments re-joins the live position.

In a headless-browser test, two listeners whose device clocks disagreed by
11.5 s, joining 3.5 s apart, heard the same notes within 4 ms (median) and
27 ms (worst).

Changing the playlist (adding, removing or reordering radio songs) shifts the
schedule for everyone, which is fine as long as everyone loads the same build.

## Stock songs

All traditional or public domain, transcribed in `scripts/generate-demo-midi.mjs`:
Greensleeves, Drunken Sailor, The Entertainer (Joplin), Oh! Susanna (Foster),
Amazing Grace, Ode to Joy (Beethoven), Auld Lang Syne, Sakura Sakura, and Happy
Birthday (free play only). Modern pop songs are under copyright, so they aren't
bundled; you can still play your own `.mid` files under Advanced → Upload.

## How it works

- **Settings** (`src/themes.ts`): each setting picks an instrument set, a
  colour palette and an animation motif (candle motes, hearth embers, leaves,
  petals, bubbles, fog, sparkles) that reacts to every note as it's heard.
- **Songs**: `.mid` files, stock or uploaded (Advanced). Parsed with
  `@tonejs/midi` into a plain model.
- **Instrument sets** (`src/music/instruments.ts`): each set is a palette of
  ~10 voices with roles (lead, harmony, pad, accent, bass) plus a percussion
  instrument. Tracks are matched to roles by register (top line = lead, lowest =
  bass), by split lane, and by the track's original General MIDI instrument
  (choir, strings and organs become pads; bells and mallets become accents).
  Instruments aren't reused until the palette runs out. Drums are mapped onto
  the set's percussion instrument (kick, toms and snare only). Any track can be
  overridden individually.
- **Voice splitting** (`src/music/split.ts`): many MIDIs (piano arrangements
  especially) put everything in one track. Polyphonic tracks are split into
  melody / harmony / bass by what is sounding at each note's start: the top
  note is melody, the lowest is bass, inner notes are harmony. This happens
  automatically for files with one or two pitched tracks, and any track can be
  split or merged by hand in the Tracks list.
- **Note sets** (`src/music/noteSets.ts`): target scales. Every note is
  remapped into the chosen scale, relative to the song's key (auto-detected,
  or picked by hand).
  - 7-note scales (Dorian, Phrygian, harmonic minor...) use *degree mapping*:
    a minor-key song keeps its melodic shape and only the altered degrees
    change.
  - Other scales (pentatonics, Hirajoshi, whole tone...) snap each note to the
    nearest scale tone.
- **Playback** (`src/music/engine.ts`): soundfont instruments via `smplr`,
  scheduled on the Web Audio clock. Changing sets, tempo or instruments while
  playing re-schedules from the current position.

## Adding sets

Add an entry to `INSTRUMENT_SETS` or `NOTE_SETS` and it shows up in the UI.
Instruments are General MIDI soundfont names; add new ones to `INSTRUMENTS`.

## Notes

- Instrument samples load from a soundfont CDN the first time they are used.
  If one fails to load, it falls back to piano and shows a message.
- The bundled demo songs are traditional (public domain) tunes. Uploaded files
  are processed in the browser and never leave it.
