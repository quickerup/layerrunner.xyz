/**
 * Escapes Telegram legacy Markdown's four escapable special characters
 * (_ * ` [) in dynamic text before it's interpolated into a Markdown-mode
 * message. Any one unescaped occurrence anywhere in the message causes
 * Telegram to reject the whole sendMessage call with a 400 parse error —
 * this must be applied to any user-typed text or API-sourced string
 * (repo names, descriptions, branch names, etc.) before interpolation.
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/([_*`[])/g, '\\$1');
}
