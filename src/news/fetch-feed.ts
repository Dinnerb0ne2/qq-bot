// Streaming, size-capped, conditional-GET fetch of a feed URL (adapted from
// iread's src/server/fetch-feed.ts). The body is read incrementally and the
// request aborted the moment cumulative bytes exceed MAX_BYTES. Feed URLs come
// from operator config (not chat input), so iread's SSRF guard is omitted.

const USER_AGENT = 'qq-bot-news/1.0 (+RSS news summarizer)'
const FETCH_TIMEOUT_MS = 15_000
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

export interface FetchInput {
  feedUrl: string
  etag: string | null
  lastModified: string | null
}

export type FetchResult =
  | { kind: 'notModified' }
  | { kind: 'ok'; xml: string; etag: string | null; lastModified: string | null }

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

export async function fetchFeed(input: FetchInput): Promise<FetchResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.1',
    }
    if (input.etag) headers['If-None-Match'] = input.etag
    if (input.lastModified) headers['If-Modified-Since'] = input.lastModified

    const res = await fetch(input.feedUrl, { headers, signal: ctrl.signal })

    if (res.status === 304) {
      await res.body?.cancel().catch(() => {})
      return { kind: 'notModified' }
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {})
      throw new Error(`HTTP ${res.status} ${res.statusText}`)
    }

    // Fast reject on advertised Content-Length (untrusted but cheap).
    const cl = Number(res.headers.get('content-length'))
    if (Number.isFinite(cl) && cl > MAX_BYTES) {
      await res.body?.cancel().catch(() => {})
      throw new Error(`feed too large (${cl} bytes)`)
    }

    if (!res.body) {
      throw new Error('empty response body')
    }

    // Stream the body, aborting once cumulative size exceeds the cap.
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > MAX_BYTES) {
        ctrl.abort()
        throw new Error(`feed too large (> ${MAX_BYTES} bytes)`)
      }
      chunks.push(value)
    }

    const xml = new TextDecoder('utf-8').decode(concat(chunks, total))
    return {
      kind: 'ok',
      xml,
      etag: res.headers.get('etag'),
      lastModified: res.headers.get('last-modified'),
    }
  } finally {
    clearTimeout(timer)
  }
}
