import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deflateRawSync } from 'node:zlib'
import { DEFAULT_BPM, parseMusicXml } from './musicxml.ts'
import { parseXml, textOf, child } from './xml.ts'
import { extractMusicXml, isZip } from './zip.ts'

const SCORE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work><work-title>Tom &amp; Jerry&#39;s Jig</work-title></work>
  <part-list>
    <score-part id="P1"><part-name>Flute</part-name>
      <midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>74</midi-program></midi-instrument>
    </score-part>
    <score-part id="P2"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>2</divisions></attributes>
      <direction><sound tempo="60"/></direction>
      <!-- C4 quarter, then E4+G4 chord quarter, a rest, then a tied D4 across the barline -->
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice></note>
      <note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice></note>
      <note><rest/><duration>2</duration><voice>1</voice></note>
      <note><pitch><step>D</step><alter>1</alter><octave>4</octave></pitch><duration>2</duration><tie type="start"/><voice>1</voice></note>
    </measure>
    <measure number="2">
      <note><pitch><step>D</step><alter>1</alter><octave>4</octave></pitch><duration>4</duration><tie type="stop"/><voice>1</voice></note>
      <note><grace/><pitch><step>B</step><octave>4</octave></pitch><voice>1</voice></note>
    </measure>
  </part>
  <part id="P2">
    <measure number="1">
      <attributes><divisions>1</divisions><staves>2</staves></attributes>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note>
      <backup><duration>4</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>2</duration><voice>2</voice><staff>2</staff></note>
      <note><pitch><step>G</step><octave>2</octave></pitch><duration>2</duration><voice>2</voice><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`

test('xml: elements, attributes, entities, comments and doctype', () => {
  const doc = parseXml(SCORE)
  const score = child(doc, 'score-partwise')!
  assert.equal(score.attrs.version, '3.1')
  assert.equal(textOf(child(score, 'work'), 'work-title'), "Tom & Jerry's Jig")
})

test('musicxml: pitches, chords, rests, ties and grace notes', () => {
  const song = parseMusicXml(SCORE, 'fallback')
  assert.equal(song.name, "Tom & Jerry's Jig")
  const flute = song.tracks.find((t) => t.name === 'Flute')!
  assert.equal(flute.program, 73) // MusicXML programs are 1-based
  // tempo 60 => one quarter = 1 s
  assert.deepEqual(
    flute.notes.map((n) => [n.midi, n.time, n.duration]),
    [
      [60, 0, 1],
      [64, 1, 1],
      [67, 1, 1],
      [63, 3, 3], // tied D#4: 1 beat + 2 beats, grace note skipped
    ],
  )
})

test('musicxml: multi-staff parts become separate tracks, backup rewinds time', () => {
  const song = parseMusicXml(SCORE, 'x')
  const upper = song.tracks.find((t) => t.name === 'Piano (upper)')!
  const lower = song.tracks.find((t) => t.name === 'Piano (lower)')!
  assert.deepEqual(upper.notes.map((n) => [n.midi, n.time, n.duration]), [[69, 0, 4]])
  assert.deepEqual(lower.notes.map((n) => [n.midi, n.time]), [[48, 0], [43, 2]])
  assert.equal(song.duration, 6)
})

test('musicxml: default tempo, dotted metronome and dynamics', () => {
  const bare = parseMusicXml(
    `<score-partwise><part-list><score-part id="P"><part-name>V</part-name></score-part></part-list>
     <part id="P"><measure><attributes><divisions>1</divisions></attributes>
     <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration></note></measure></part></score-partwise>`,
    'x',
  )
  assert.ok(Math.abs(bare.tracks[0].notes[0].duration - 60 / DEFAULT_BPM) < 1e-9)

  const marked = parseMusicXml(
    `<score-partwise><part-list><score-part id="P"><part-name>V</part-name></score-part></part-list>
     <part id="P"><measure><attributes><divisions>2</divisions></attributes>
     <direction><direction-type><metronome><beat-unit>quarter</beat-unit><beat-unit-dot/><per-minute>40</per-minute></metronome></direction-type></direction>
     <direction><direction-type><dynamics><pp/></dynamics></direction-type></direction>
     <note><pitch><step>C</step><octave>5</octave></pitch><duration>3</duration></note></measure></part></score-partwise>`,
    'x',
  )
  // dotted quarter = 40  =>  60 quarters per minute  =>  1.5 beats = 1.5 s
  const n = marked.tracks[0].notes[0]
  assert.ok(Math.abs(n.duration - 1.5) < 1e-9, `got ${n.duration}`)
  assert.equal(n.velocity, 0.35)
})

test('musicxml: rejects things that are not scores', () => {
  assert.throws(() => parseMusicXml('<html></html>', 'x'), /MusicXML/)
})

/** Build a .mxl (zip) in memory, with a stored container and a deflated score. */
function makeMxl(scorePath: string, score: string): ArrayBuffer {
  const enc = new TextEncoder()
  const files = [
    {
      name: 'META-INF/container.xml',
      data: enc.encode(`<container><rootfiles><rootfile full-path="${scorePath}"/></rootfiles></container>`),
      deflate: false,
    },
    { name: scorePath, data: enc.encode(score), deflate: true },
  ]
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.name)
    const body = f.deflate ? new Uint8Array(deflateRawSync(f.data)) : f.data
    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(8, f.deflate ? 8 : 0, true)
    lv.setUint32(18, body.length, true)
    lv.setUint32(22, f.data.length, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    const cd = new Uint8Array(46 + name.length)
    const cv = new DataView(cd.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(10, f.deflate ? 8 : 0, true)
    cv.setUint32(20, body.length, true)
    cv.setUint32(24, f.data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    cd.set(name, 46)
    parts.push(local, body)
    central.push(cd)
    offset += local.length + body.length
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, cdSize, true)
  ev.setUint32(16, offset, true)
  const all = [...parts, ...central, eocd]
  const out = new Uint8Array(all.reduce((s, a) => s + a.length, 0))
  let p = 0
  for (const a of all) {
    out.set(a, p)
    p += a.length
  }
  return out.buffer
}

test('mxl: finds the score via META-INF/container.xml and inflates it', async () => {
  const buf = makeMxl('scores/main.musicxml', SCORE)
  assert.ok(isZip(new Uint8Array(buf)))
  const xml = await extractMusicXml(buf)
  assert.equal(xml, SCORE)
  assert.equal(parseMusicXml(xml, 'x').tracks.length, 3)
})

test('mxl: garbage is rejected', async () => {
  await assert.rejects(() => extractMusicXml(new Uint8Array([1, 2, 3, 4, 5]).buffer), /zip/)
})
