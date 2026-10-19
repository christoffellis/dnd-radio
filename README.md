# DnD Radio

Play MIDI files with instrument and scale sets tuned for tabletop sessions.
Load a song, pick a setting (tavern, Celtic, East Asian, dungeon...) and the
song is re-voiced and re-scaled to match.

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

## How it works

- **Songs**: `.mid` files, uploaded or from `public/midi` (listed in
  `public/midi/index.json`). Parsed with `@tonejs/midi` into a plain model.
- **Instrument sets** (`src/music/instruments.ts`): an ordered list of voices
  `[lead, second, third, ..., bass]`. The highest track gets the lead, the
  lowest gets the bass voice, the rest fill in between. Each track can still be
  overridden individually. Drum tracks are muted by default.
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
