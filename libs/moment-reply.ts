// Replies are ordinary DM text so older clients can read them. Current senders
// flag the permalink; older senders used one of these localized prefixes.
const legacyHeaders = new Set([
  'Replied to your moment', 'A répondu à votre moment', 'Anına yanıt verdi',
  'Reageerde op je moment', 'Respondió a tu momento', 'ردّ على لحظتك',
]);

export function parseMomentReply(content?: string | null, localOrigin?: string) {
  if (!content?.includes('/moment/')) return null;
  const match = /^([^:\n]{1,100}):[ \t]*([\s\S]*?)\r?\n(https?:\/\/[^\s]+)$/i.exec(content.trim());
  if (!match) return null;
  const moment = momentLink(match[3], localOrigin);
  if (!moment || (!moment.reply && !legacyHeaders.has(match[1].trim()))) return null;
  return { id: moment.id, text: match[2].trim() };
}

function momentLink(raw: string, localOrigin?: string) {
  try {
    const url = new URL(raw);
    if (url.username || url.password || (url.origin !== localOrigin
      && !/^https?:\/\/(?:www\.)?(?:riftn\.com|dehub\.io)$/i.test(url.origin))) return null;
    const path = /^\/(?:app\/)?moment\/([a-f0-9]{24})\/?$/i.exec(url.pathname);
    return path ? { id: path[1], reply: url.searchParams.get('reply') === '1', mention: url.searchParams.get('mention') === '1' } : null;
  } catch {
    return null;
  }
}

export function parseSharedMoment(content?: string | null) {
  if (!content?.includes('/moment/')) return null;
  const lines = content.trim().split(/\r?\n/);
  const link = momentLink(lines.pop()!.trim());
  if (!link || link.reply) return null;
  // "Mentioned you in their moment": the server's DM to someone tagged on it.
  // The card says that itself, in the reader's language.
  if (link.mention) return { id: link.id, text: '', shared: true as const, mention: true as const };
  return { id: link.id, text: lines.join('\n').trim(), shared: true as const };
}
