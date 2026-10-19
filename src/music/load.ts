import { parseAbc } from './abc.ts'
import { accompany } from './accompany.ts'
import { parseMidi } from './midi.ts'
import { parseMusicXml } from './musicxml.ts'
import type { Song } from './types.ts'
import { extractMusicXml, isZip } from './zip.ts'

export type SongFormat = 'midi' | 'mxl' | 'musicxml' | 'abc'

/** Work out the format from the bytes first, then the file name. */
export function detectFormat(name: string, bytes: Uint8Array): SongFormat {
  if (bytes[0] === 0x4d && bytes[1] === 0x54 && bytes[2] === 0x68 && bytes[3] === 0x64) return 'midi' // MThd
  if (isZip(bytes)) return 'mxl'
  const head = new TextDecoder().decode(bytes.subarray(0, 2048)).replace(/^﻿/, '').trimStart()
  if (head.startsWith('<')) return 'musicxml'
  if (/^(X|T|K):/m.test(head) || /\.abc$/i.test(name)) return 'abc'
  if (/\.(mid|midi)$/i.test(name)) return 'midi'
  if (/\.mxl$/i.test(name)) return 'mxl'
  return 'musicxml'
}

export const ACCEPTED_FILES = '.mid,.midi,.mxl,.musicxml,.xml,.abc,audio/midi'

/** Parse any supported file into a Song, adding accompaniment to bare melodies. */
export async function songFromBuffer(buffer: ArrayBuffer, name: string, tune?: number): Promise<Song> {
  const bytes = new Uint8Array(buffer)
  const format = detectFormat(name, bytes)
  let song: Song
  switch (format) {
    case 'midi':
      song = parseMidi(buffer, name)
      break
    case 'mxl':
      song = parseMusicXml(await extractMusicXml(buffer), name)
      break
    case 'musicxml':
      song = parseMusicXml(new TextDecoder().decode(bytes), name)
      break
    case 'abc':
      song = parseAbc(new TextDecoder().decode(bytes), name, tune)
      break
  }
  if (song.tracks.length === 0) throw new Error('That file has no notes.')
  return accompany(song)
}

const cache = new Map<string, Promise<Song>>()

/** Fetch and parse a song once; failures are not cached, so they can be retried. */
export function fetchSong(url: string, title: string, tune?: number): Promise<Song> {
  const key = `${url}#${tune ?? ''}`
  let p = cache.get(key)
  if (!p) {
    p = (async () => {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Couldn’t load “${title}” (${res.status}).`)
      const song = await songFromBuffer(await res.arrayBuffer(), url.split('/').pop() ?? title, tune)
      return { ...song, name: title }
    })()
    cache.set(key, p)
    p.catch(() => cache.delete(key))
  }
  return p
}
