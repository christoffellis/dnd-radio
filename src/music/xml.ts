/**
 * A tiny, dependency-free XML parser: enough for MusicXML, and it runs the same
 * in the browser and in Node tests (where there is no DOMParser).
 */

export interface XNode {
  name: string
  attrs: Record<string, string>
  children: XNode[]
  text: string
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[body] ?? whole
  })
}

const ATTR = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g

export function parseXml(source: string): XNode {
  const root: XNode = { name: '#document', attrs: {}, children: [], text: '' }
  const stack: XNode[] = [root]
  let i = 0
  const n = source.length

  while (i < n) {
    const lt = source.indexOf('<', i)
    if (lt < 0) break
    if (lt > i) {
      const text = source.slice(i, lt)
      if (text.trim()) stack[stack.length - 1].text += decodeEntities(text)
    }

    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt + 4)
      i = end < 0 ? n : end + 3
    } else if (source.startsWith('<![CDATA[', lt)) {
      const end = source.indexOf(']]>', lt + 9)
      stack[stack.length - 1].text += source.slice(lt + 9, end < 0 ? n : end)
      i = end < 0 ? n : end + 3
    } else if (source.startsWith('<?', lt)) {
      const end = source.indexOf('?>', lt + 2)
      i = end < 0 ? n : end + 2
    } else if (source.startsWith('<!', lt)) {
      // DOCTYPE, possibly with an internal subset in [...]
      let j = lt + 2
      let depth = 0
      while (j < n) {
        const c = source[j]
        if (c === '[') depth++
        else if (c === ']') depth--
        else if (c === '>' && depth <= 0) break
        j++
      }
      i = j + 1
    } else if (source[lt + 1] === '/') {
      const end = source.indexOf('>', lt + 2)
      const name = source.slice(lt + 2, end).trim()
      // Pop back to the matching element (tolerates sloppy nesting).
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) {
          stack.length = k
          break
        }
      }
      i = end + 1
    } else {
      // Find the end of the tag, skipping '>' inside quoted attribute values.
      let j = lt + 1
      let quote = ''
      while (j < n) {
        const c = source[j]
        if (quote) {
          if (c === quote) quote = ''
        } else if (c === '"' || c === "'") quote = c
        else if (c === '>') break
        j++
      }
      let body = source.slice(lt + 1, j)
      const selfClosing = body.endsWith('/')
      if (selfClosing) body = body.slice(0, -1)
      const space = body.search(/\s/)
      const name = space < 0 ? body : body.slice(0, space)
      const attrs: Record<string, string> = {}
      if (space >= 0) {
        ATTR.lastIndex = 0
        const rest = body.slice(space)
        let m: RegExpExecArray | null
        while ((m = ATTR.exec(rest))) attrs[m[1]] = decodeEntities(m[3] ?? m[4] ?? '')
      }
      const node: XNode = { name, attrs, children: [], text: '' }
      stack[stack.length - 1].children.push(node)
      if (!selfClosing) stack.push(node)
      i = j + 1
    }
  }
  return root
}

export function child(node: XNode | undefined, name: string): XNode | undefined {
  return node?.children.find((c) => c.name === name)
}

export function children(node: XNode | undefined, name: string): XNode[] {
  return node ? node.children.filter((c) => c.name === name) : []
}

export function textOf(node: XNode | undefined, name: string): string | undefined {
  const c = child(node, name)
  return c ? c.text.trim() : undefined
}
