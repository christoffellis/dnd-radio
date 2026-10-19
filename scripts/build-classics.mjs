// Builds public/classics.json: a curated set of public-domain classics from the
// music21 corpus (https://github.com/cuthbertLab/music21). The scores are NOT
// copied into this repo; the app loads them at runtime from GitHub, pinned to
// one commit so the radio schedule (which uses these durations) never shifts.
//
// To add a piece: add it to PIECES, then run against a checkout of that commit:
//   git clone --depth 1 --filter=blob:none --sparse https://github.com/cuthbertLab/music21
//   (cd music21 && git sparse-checkout set music21/corpus)
//   node scripts/build-classics.mjs path/to/music21/music21/corpus
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseAbc } from '../src/music/abc.ts'
import { parseMusicXml } from '../src/music/musicxml.ts'
import { extractMusicXml } from '../src/music/zip.ts'

const COMMIT = '1e68f5fc08970e8cee1e25627039dc0b64275367'
const BASE = `https://raw.githubusercontent.com/cuthbertLab/music21/${COMMIT}/music21/corpus/`

// [group, path, title, composer, genre stations]. Genres are theme ids (src/themes.ts).
const C = 'Classics'
const F = 'Fiddle tunes'
const PIECES = [
  [C, 'joplin/maple_leaf_rag.mxl', 'Maple Leaf Rag', 'Scott Joplin', ['tavern', 'tropical', 'kobold']],
  [C, 'monteverdi/madrigal.3.1.mxl', 'La giovinetta pianta', 'Claudio Monteverdi', ['court', 'medieval']],
  [C, 'bach/bwv66.6.mxl', 'Chorale, BWV 66.6', 'J. S. Bach', ['dungeon']],
  [C, 'liliuokalani/aloha_oe.mxl', 'Aloha ʻOe', 'Liliʻuokalani', ['tropical', 'asian']],
  [C, 'trecento/PMFC_04-Cara mi donna.xml', 'Cara mi donna', 'Francesco Landini', ['medieval']],
  [C, 'handel/rinaldo/Lascia_chio_pianga.mxl', 'Lascia ch’io pianga', 'G. F. Handel', ['court', 'dungeon']],
  [C, 'leadSheet/fosterBrownHair.mxl', 'Jeanie with the Light Brown Hair', 'Stephen Foster', ['tavern', 'asian']],
  [C, 'corelli/opus3no1/1grave.xml', 'Sonata da chiesa Op. 3 No. 1: Grave', 'Arcangelo Corelli', ['dungeon', 'court']],
  [C, 'trecento/PMFC_06_8-In Verde Prato.xml', 'In verde prato', 'Italian Trecento', ['medieval']],
  [C, 'schubert/Lindenbaum.xml', 'Der Lindenbaum', 'Franz Schubert', ['dungeon']],
  [C, 'bach/bwv1.6.mxl', 'Wie schön leuchtet der Morgenstern', 'J. S. Bach', ['dungeon']],
  [C, 'lusitano/allor_che_ignuda.mxl', 'Allor che ignuda', 'Vicente Lusitano', ['medieval', 'court']],
  [C, 'schumann_clara/polonaise_op1n1.mxl', 'Polonaise Op. 1 No. 1', 'Clara Schumann', ['court']],
  [C, 'mozart/k545/movement1_exposition.mxl', 'Sonata K. 545 (opening)', 'W. A. Mozart', ['court']],
  [C, 'schumann_robert/dichterliebe_no2.xml', 'Aus meinen Tränen sprießen', 'Robert Schumann', ['court', 'asian']],
  [C, 'cpebach/h186.mxl', 'Sonata H. 186: Poco adagio', 'C. P. E. Bach', ['dungeon']],
  [C, 'bach/bwv10.7.mxl', 'Chorale, BWV 10.7', 'J. S. Bach', ['dungeon']],
  [C, 'haydn/opus74no1/movement2.mxl', 'String Quartet Op. 74 No. 1: Andantino', 'Joseph Haydn', ['court']],
  [C, 'beach/prayer_of_a_tired_child.musicxml', 'Prayer of a Tired Child', 'Amy Beach', ['dungeon']],
  [C, 'ciconia/quod_jactatur.xml', 'Quod jactatur', 'Johannes Ciconia', ['medieval', 'asian']],
  [C, 'beethoven/opus18no1/movement2.mxl', 'String Quartet Op. 18 No. 1: Adagio', 'Ludwig van Beethoven', ['dungeon']],
  [C, 'mozart/k458/movement1.mxl', '“Hunt” Quartet K. 458: Allegro', 'W. A. Mozart', ['court']],

  // Ryan's Mammoth Collection (1883) of fiddle tunes.
  [F, 'ryansMammoth/IrishWashWomanJig.abc', 'The Irish Washerwoman', 'Traditional', ['celtic', 'tavern']],
  [F, 'ryansMammoth/GarryOwenJig.abc', 'Garryowen', 'Traditional', ['celtic']],
  [F, 'ryansMammoth/HasteToTheWeddingJig.abc', 'Haste to the Wedding', 'Traditional', ['celtic', 'tavern']],
  [F, 'ryansMammoth/LarkInTheMorningJig.abc', 'The Lark in the Morning', 'Traditional', ['celtic', 'asian']],
  [F, 'ryansMammoth/SwallowTailJig.abc', 'The Swallowtail Jig', 'Traditional', ['celtic']],
  [F, 'ryansMammoth/RoryOMoreJig.abc', 'Rory O’More', 'Traditional', ['celtic']],
  [F, 'ryansMammoth/StPatricksDayInTheMorningJig.abc', 'St. Patrick’s Day in the Morning', 'Traditional', ['celtic']],
  [F, 'ryansMammoth/MasonsApronReel.abc', 'The Mason’s Apron', 'Traditional', ['celtic']],
  [F, 'ryansMammoth/TullochgorumReel.abc', 'Tullochgorum', 'Traditional', ['celtic']],
  [F, 'ryansMammoth/MissMcCloudsReel.abc', 'Miss McLeod’s Reel', 'Traditional', ['celtic']],
  [F, 'ryansMammoth/FairyDanceReel.abc', 'The Fairy Dance', 'Traditional', ['celtic', 'asian']],
  [F, 'ryansMammoth/FlowersOfEdinburgReel.abc', 'The Flowers of Edinburgh', 'Traditional', ['celtic']],
  [F, 'ryansMammoth/DuncanDavidsonStrathspey.abc', 'Duncan Davidson', 'Traditional', ['celtic']],
  [F, 'ryansMammoth/MarquisOfHuntlysStrathspey.abc', 'The Marquis of Huntly', 'Traditional', ['celtic', 'medieval']],
  [F, 'ryansMammoth/42dHighlandRegimentStrathspey.abc', 'The 42nd Highland Regiment', 'Traditional', ['celtic']],
  [F, 'ryansMammoth/PipersLassReel.abc', 'The Piper’s Lass', 'Traditional', ['celtic']],
  [F, 'ryansMammoth/CherishTheLadiesJig.abc', 'Cherish the Ladies', 'Traditional', ['celtic']],
  [F, 'ryansMammoth/GreenSleevesJig.abc', 'Greensleeves (jig)', 'Traditional', ['celtic', 'medieval']],
  [F, 'ryansMammoth/BlackberryBlossomReel.abc', 'Blackberry Blossom', 'Traditional', ['celtic', 'tavern']],
  [F, 'ryansMammoth/SoldiersJoy.abc', 'Soldier’s Joy', 'Traditional', ['tavern']],
  [F, 'ryansMammoth/FishersHornpipe.abc', 'Fisher’s Hornpipe', 'Traditional', ['tavern', 'tropical']],
  [F, 'ryansMammoth/DurangsHornpipe.abc', 'Durang’s Hornpipe', 'Traditional', ['tavern']],
  [F, 'ryansMammoth/ArkansasTravellerReel.abc', 'Arkansas Traveller', 'Traditional', ['tavern']],
  [F, 'ryansMammoth/DevilsDreamReel.abc', 'The Devil’s Dream', 'Traditional', ['tavern', 'kobold']],
  [F, 'ryansMammoth/SpeedThePloughReel.abc', 'Speed the Plough', 'Traditional', ['tavern']],
  [F, 'ryansMammoth/BottleOfBrandyJig.abc', 'The Bottle of Brandy', 'Traditional', ['tavern', 'kobold']],
  [F, 'ryansMammoth/DropOfWhiskeySlipjig.abc', 'A Drop of Whiskey', 'Traditional', ['tavern', 'kobold']],
  [F, 'ryansMammoth/TeetotalersReel.abc', 'The Teetotaler’s Reel', 'Traditional', ['tavern']],
  [F, 'ryansMammoth/PaddyOnTheTurnpikeReel.abc', 'Paddy on the Turnpike', 'Traditional', ['tavern']],
  [F, 'ryansMammoth/SmashTheWindowsJig.abc', 'Smash the Windows', 'Traditional', ['tavern', 'kobold']],
  [F, 'ryansMammoth/LeatherTheWigJig.abc', 'Leather the Wig', 'Traditional', ['kobold']],
  [F, 'ryansMammoth/LiverpoolHornpipe.abc', 'The Liverpool Hornpipe', 'Traditional', ['tropical']],
  [F, 'ryansMammoth/StatenIslandHornpipe.abc', 'Staten Island Hornpipe', 'Traditional', ['tropical']],
  [F, 'ryansMammoth/SailorsRansomReel.abc', 'The Sailor’s Ransom', 'Traditional', ['tropical']],
  [F, 'ryansMammoth/MorpethHornpipe.abc', 'Morpeth Hornpipe', 'Traditional', ['tropical']],
  [F, 'ryansMammoth/RickettsHornpipe.abc', 'Ricketts’ Hornpipe', 'Traditional', ['tropical']],
  [F, 'ryansMammoth/FlyByNightLancashireClog.abc', 'Fly-by-Night Clog', 'Traditional', ['kobold']],
  [F, 'ryansMammoth/SkipRopeClog.abc', 'Skip Rope Clog', 'Traditional', ['kobold']],
  [F, 'ryansMammoth/MoneyInAdvanceClog.abc', 'Money in Advance', 'Traditional', ['kobold']],
  [F, 'ryansMammoth/NightingaleClog.abc', 'The Nightingale Clog', 'Traditional', ['kobold']],
  [F, 'ryansMammoth/MinstrelsFancyClog.abc', 'The Minstrel’s Fancy', 'Traditional', ['kobold', 'medieval']],
  [F, 'ryansMammoth/BlueStockingClog.abc', 'Blue Stocking Clog', 'Traditional', ['kobold']],
]

const corpus = process.argv[2]
if (!corpus) {
  console.error('usage: node scripts/build-classics.mjs path/to/music21/music21/corpus')
  process.exit(1)
}

const pieces = []
for (const [group, path, title, composer, genres] of PIECES) {
  const buf = readFileSync(join(corpus, path))
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  const song = path.endsWith('.abc')
    ? parseAbc(buf.toString('utf8'), title)
    : parseMusicXml(path.endsWith('.mxl') ? await extractMusicXml(ab) : buf.toString('utf8'), title)
  pieces.push({ group, path, title, composer, duration: Math.round(song.duration * 1000) / 1000, genres })
  console.log(`${song.duration.toFixed(1).padStart(6)}s  ${title}`)
}

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'classics.json')
writeFileSync(
  out,
  JSON.stringify(
    {
      source: 'music21 corpus',
      license:
        'Public-domain works. Some encodings are licensed for non-commercial use only; see the music21 corpus.',
      repo: 'https://github.com/cuthbertLab/music21',
      base: BASE,
      pieces,
    },
    null,
    2,
  ) + '\n',
)
console.log(`wrote ${out}`)
