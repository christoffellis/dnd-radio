/**
 * Minimal ZIP reader for compressed MusicXML (.mxl). Uses the platform's
 * DecompressionStream('deflate-raw'), available in modern browsers and Node.
 */

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4
}

/** Read all file entries of a ZIP archive. */
export async function readZip(buffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)

  // End of central directory: scan back from the end (it may have a comment).
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Not a valid .mxl (zip) file.')

  const count = view.getUint16(eocd + 10, true)
  let p = view.getUint32(eocd + 16, true)
  const files = new Map<string, Uint8Array>()
  const decoder = new TextDecoder()

  for (let k = 0; k < count; k++) {
    if (view.getUint32(p, true) !== 0x02014b50) break
    const method = view.getUint16(p + 10, true)
    const compressedSize = view.getUint32(p + 20, true)
    const nameLength = view.getUint16(p + 28, true)
    const extraLength = view.getUint16(p + 30, true)
    const commentLength = view.getUint16(p + 32, true)
    const localOffset = view.getUint32(p + 42, true)
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLength))
    p += 46 + nameLength + extraLength + commentLength

    if (name.endsWith('/')) continue
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const start = localOffset + 30 + localNameLength + localExtraLength
    const data = bytes.subarray(start, start + compressedSize)
    if (method === 0) files.set(name, data)
    else if (method === 8) files.set(name, await inflateRaw(data))
    // Other compression methods are not used by MusicXML tools.
  }
  return files
}

/** Pull the main score out of an .mxl archive, as XML text. */
export async function extractMusicXml(buffer: ArrayBuffer): Promise<string> {
  const files = await readZip(buffer)
  const decoder = new TextDecoder()
  const container = files.get('META-INF/container.xml')
  if (container) {
    const m = /full-path\s*=\s*["']([^"']+)["']/.exec(decoder.decode(container))
    const main = m && files.get(m[1])
    if (main) return decoder.decode(main)
  }
  for (const [name, data] of files) {
    if (!name.startsWith('META-INF/') && /\.(xml|musicxml)$/i.test(name)) return decoder.decode(data)
  }
  throw new Error('No score found in that .mxl file.')
}
