// Shared rendering for news summaries. The interactive `news` reply and the
// scheduled group push send the same Markdown body, so the length cap and
// truncation rules live here rather than in each caller.

/** QQ group messages have a length cap; stay comfortably under it. */
export const NEWS_REPLY_MAX = 3500

/**
 * Render a stored summary as the Markdown message body, capped at
 * NEWS_REPLY_MAX. Over-long text is cut at the last newline inside the cap so
 * truncation never leaves a dangling half-written `[label](url)` link — unless
 * that newline sits in the first half (the summary is one huge line, so the
 * only newlines are the header's own), where a hard slice keeps the content
 * instead of collapsing the message to its header.
 */
export function formatNewsMarkdown(date: string, summary: string): string {
  const md = `**AI news ${date}**\n\n${summary}`
  if (md.length <= NEWS_REPLY_MAX) return md
  const cut = md.lastIndexOf('\n', NEWS_REPLY_MAX)
  return cut > NEWS_REPLY_MAX / 2 ? md.slice(0, cut) : md.slice(0, NEWS_REPLY_MAX)
}

/**
 * Downgrade Markdown to plain text for a group where the markdown payload is
 * rejected: `[label](url)` keeps only the label (raw URLs in plain text would
 * trip QQ's link whitelist and sink the fallback too), bold and heading
 * markers are stripped. Lossy but readable — a fallback, not a renderer.
 */
export function markdownToPlain(md: string): string {
  return md
    .replace(/\[([^\]]*)\]\(([^)]+)\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^#+\s+/gm, '')
}
