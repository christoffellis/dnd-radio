// Adds modern songs (MIDI) to the Modern stations.
//
//   node scripts/add-modern.mjs <pack.zip | folder> [--genre=<genre>] [--map=scripts/modern-pack.json]
//
// Each song is sorted into a Modern station (pop, rock, punk, electronic,
// hiphop, film, games, piano). With --map, a curated list (content hash ->
// title, artist, genre) decides, and songs not in it are skipped; otherwise a
// sub-folder named after a genre, --genre, or a guess from the instruments and
// tempo.
// Files are copied into public/midi/modern/ and listed in public/modern.json.
// Re-running is safe: songs already added (same bytes) are skipped. To move a
// song, edit its "genres" in public/modern.json.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { basename, dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classify, splitTitle } from '../src/library/classify.ts'
import { parseSmf } from '../src/music/smf.ts'
import { readZip } from '../src/music/zip.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'midi', 'modern')
const catalogPath = join(root, 'public', 'modern.json')
const GENRES = {
  pop: 'modern-pop',
  rock: 'modern-rock',
  punk: 'modern-punk',
  electronic: 'modern-electronic',
  hiphop: 'modern-hiphop',
  film: 'modern-film',
  games: 'modern-games',
  piano: 'modern-piano',
}

const args = process.argv.slice(2)
const source = args.find((a) => !a.startsWith('--'))
const forced = args.find((a) => a.startsWith('--genre='))?.split('=')[1]?.toLowerCase()
const mapPath = args.find((a) => a.startsWith('--map='))?.split('=')[1]
const curated = mapPath ? JSON.parse(readFileSync(mapPath, 'utf8')) : null
if (!source || (forced && !GENRES[forced])) {
  console.error(`usage: node scripts/add-modern.mjs <pack.zip | folder> [--genre=${Object.keys(GENRES).join('|')}] [--map=file.json]`)
  process.exit(1)
}

/** Collect [relativePath, bytes] for every MIDI in a zip or folder (zips inside folders too). */
async function collect(path) {
  const out = []
  const addZip = async (buf, prefix) => {
    const entries = await readZip(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
    for (const [name, data] of entries) {
      if (/(^|\/)(__MACOSX|\.)/.test(name)) continue
      if (/\.zip$/i.test(name)) await addZip(Buffer.from(data), `${prefix}${name.replace(/\.zip$/i, '')}/`)
      else if (/\.midi?$/i.test(name)) out.push([prefix + name, Buffer.from(data)])
    }
  }
  if (statSync(path).isDirectory()) {
    const walk = async (dir) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) await walk(full)
        else if (/\.midi?$/i.test(name)) out.push([relative(path, full), readFileSync(full)])
        else if (/\.zip$/i.test(name)) await addZip(readFileSync(full), relative(path, full).replace(/\.zip$/i, '') + '/')
      }
    }
    await walk(path)
  } else {
    await addZip(readFileSync(path), '')
  }
  return out
}

/** A genre named by a folder in the path, e.g. "Punk/…" or "pack/Rock Hits/…". */
function genreFromPath(path) {
  for (const part of path.split('/').slice(0, -1)) {
    const k = part.toLowerCase()
    for (const g of Object.keys(GENRES)) if (k.includes(g)) return g
  }
  return undefined
}

const slug = (s) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'song'

const catalog = existsSync(catalogPath) ? JSON.parse(readFileSync(catalogPath, 'utf8')) : []
const known = new Set(catalog.map((e) => e.hash))
const usedFiles = new Set(catalog.map((e) => e.file))
mkdirSync(outDir, { recursive: true })

const files = await collect(source)
const added = []
const failed = []
let duplicates = 0
let skipped = 0
for (const [path, bytes] of files) {
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
  if (known.has(hash)) {
    duplicates++
    continue
  }
  const pick = curated?.[hash]
  if (curated && !pick) {
    skipped++
    continue
  }
  try {
    const song = parseSmf(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), basename(path))
    if (song.tracks.length === 0 || song.duration < 5) throw new Error('no notes')
    const genre = pick?.genre ?? forced ?? genreFromPath(path) ?? classify(song).toLowerCase()
    if (!GENRES[genre]) throw new Error(`unknown genre ${genre}`)
    const { title, artist } = pick ? { title: pick.title, artist: pick.artist ?? undefined } : splitTitle(basename(path))
    let file = `modern/${slug(artist ? `${artist}-${title}` : title)}.mid`
    while (usedFiles.has(file)) file = file.replace(/\.mid$/, '-2.mid')
    usedFiles.add(file)
    known.add(hash)
    writeFileSync(join(root, 'public', 'midi', file), bytes)
    const entry = {
      title,
      composer: artist ?? 'Unknown artist',
      file,
      hash,
      duration: Math.round(song.duration * 1000) / 1000,
      genres: [GENRES[genre]],
    }
    catalog.push(entry)
    added.push({ ...entry, bpm: song.bpm, programs: song.tracks.map((t) => (t.isPercussion ? 'drums' : t.program)) })
  } catch (e) {
    failed.push(`${path} (${e.message})`)
  }
}

writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n')

const byGenre = {}
for (const a of added) (byGenre[a.genres[0]] ??= []).push(a)
for (const [g, list] of Object.entries(byGenre)) {
  console.log(`\n${g} (${list.length})`)
  for (const a of list) console.log(`  ${a.title} — ${a.composer}  [${Math.round(a.duration)}s, ${a.bpm ?? '?'} bpm]`)
}
console.log(
  `\nadded ${added.length}, ${duplicates} already present, ${curated ? `${skipped} not in the map, ` : ''}${failed.length} unreadable`,
)
for (const f of failed) console.log(`  ! ${f}`)
