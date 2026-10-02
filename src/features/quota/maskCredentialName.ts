/**
 * Mask the e-mail embedded in a credential filename.
 *
 * `claude-tom@lab.dev.json` → `claude-t•••@l•••.dev.json`
 * `codex-ae5d455f-tom@lab.dev-pro.json` → `codex-ae5d455f-t•••@l•••.dev-pro.json`
 *
 * Rules, derived from the reference UI rather than from RFC 5322:
 * - the local part is whatever sits between the last `-` (or the start) and `@`;
 *   its first character survives, the rest becomes `•••`;
 * - every domain label except the last keeps its first character only;
 * - the last label (the TLD, including any `-pro`-style suffix) and a trailing
 *   `.json` extension are left intact so the provider/plan hints stay readable.
 *
 * Strings without an `@` are returned unchanged. Segments joined with ` · `
 * (the Devin "file · identity" display name) are masked independently.
 */

const MASK = '•••';
const SEGMENT_SEPARATOR = ' · ';
const JSON_EXTENSION = /\.json$/i;

const maskToken = (token: string): string => (token.length === 0 ? token : token[0] + MASK);

function maskSegment(segment: string): string {
  const at = segment.indexOf('@');
  if (at === -1) return segment;

  const extension = JSON_EXTENSION.exec(segment)?.[0] ?? '';
  const body = extension ? segment.slice(0, -extension.length) : segment;

  const local = body.slice(0, at);
  const domain = body.slice(at + 1);

  const lastDash = local.lastIndexOf('-');
  const localPrefix = lastDash === -1 ? '' : local.slice(0, lastDash + 1);
  const user = lastDash === -1 ? local : local.slice(lastDash + 1);

  const labels = domain.split('.');
  const maskedLabels =
    labels.length === 1
      ? [maskToken(labels[0])]
      : labels.map((label, index) => (index === labels.length - 1 ? label : maskToken(label)));

  return `${localPrefix}${maskToken(user)}@${maskedLabels.join('.')}${extension}`;
}

export function maskCredentialName(name: string): string {
  if (!name.includes('@')) return name;
  return name.split(SEGMENT_SEPARATOR).map(maskSegment).join(SEGMENT_SEPARATOR);
}
