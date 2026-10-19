import { test } from 'node:test'
import assert from 'node:assert/strict'
import { INSTRUMENTS, INSTRUMENT_SETS } from './instruments.ts'
import { SHAPES, familyOf, noteNameToMidi, noteNoise, parseMidiJs } from './voice.ts'

test('voice: every instrument we use has a deliberate family', () => {
  const all = new Set([
    ...INSTRUMENTS.map((i) => i.gm),
    ...INSTRUMENT_SETS.flatMap((s) => [...s.voices.map((v) => v.gm), s.percussion]),
  ])
  for (const gm of all) assert.ok(SHAPES[familyOf(gm)], gm)
  assert.equal(familyOf('violin'), 'bowed')
  assert.equal(familyOf('koto'), 'pluck')
  assert.equal(familyOf('shakuhachi'), 'wind')
})

test('voice: sustained families swell and loop, plucked ones snap', () => {
  for (const f of ['bowed', 'wind', 'reed', 'brass', 'voice'] as const) {
    assert.ok(SHAPES[f].attack[0] >= 0.02, f)
    assert.ok(SHAPES[f].loop, f)
    assert.ok(SHAPES[f].bloom, f)
  }
  for (const f of ['pluck', 'struck', 'perc'] as const) {
    assert.ok(SHAPES[f].attack[1] <= 0.01, f)
    assert.ok(!SHAPES[f].loop, f)
  }
  for (const s of Object.values(SHAPES)) {
    assert.ok(s.attack[0] <= s.attack[1] && s.release[0] <= s.release[1])
  }
})

test('voice: note names', () => {
  assert.equal(noteNameToMidi('A0'), 21)
  assert.equal(noteNameToMidi('C4'), 60)
  assert.equal(noteNameToMidi('Bb4'), 70)
  assert.equal(noteNameToMidi('Db-1'), 1)
  assert.equal(noteNameToMidi('H2'), null)
})

test('voice: MIDI.js soundfont files parse', () => {
  const src = `if (typeof(MIDI) === 'undefined') var MIDI = {};
if (typeof(MIDI.Soundfont) === 'undefined') MIDI.Soundfont = {};
MIDI.Soundfont.flute = {
"A0": "data:audio/mp3;base64,AAAA",
"Bb0": "data:audio/mp3;base64,BBBB",
}
`
  assert.deepEqual(parseMidiJs(src), { A0: 'data:audio/mp3;base64,AAAA', Bb0: 'data:audio/mp3;base64,BBBB' })
  assert.throws(() => parseMidiJs('nope'))
})

test('voice: per-note variation is deterministic and spread out', () => {
  assert.equal(noteNoise(60, 1.25, 3), noteNoise(60, 1.25, 3))
  const values = Array.from({ length: 400 }, (_, i) => noteNoise(60 + (i % 12), i * 0.137, 1))
  assert.ok(values.every((v) => v >= 0 && v < 1))
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  assert.ok(mean > 0.4 && mean < 0.6, `mean ${mean}`)
})
