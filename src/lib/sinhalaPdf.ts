/**
 * Sinhala text in exported PDFs.
 *
 * The PDF library draws glyphs strictly left to right, one per character, and
 * does not do the rearranging that Sinhala needs. Two things therefore have to
 * be done to the text by hand before it is handed over.
 *
 * 1. Vowel signs that belong on BOTH sides of a letter.
 *    "කො" is stored as ක followed by ො, but it is written with one stroke to
 *    the left of ක and one to the right. Handed over untouched it comes out as
 *    "කෙො" — the left-hand stroke stranded after the letter it belongs in
 *    front of. So the sign is split and its left part moved ahead of the
 *    letter it wraps.
 *
 * 2. Joined letters (බැඳි අකුරු).
 *    "ශ්‍රී" asks for ශ and ර to be fused into a single joined shape, which
 *    only a shaping engine can build. Asked for it anyway, the PDF library
 *    stacks the two letters on top of each other and the word becomes a blot.
 *    The join is therefore dropped, giving "ශ්රී" — the same word in its
 *    unjoined spelling, which reads correctly and is how most people type it.
 *
 * Everyday Sinhala comes out right. Only the joined letters differ from what
 * the app itself shows, and they stay readable.
 */

/** Vowel signs with a part that belongs in front: [what goes before, what goes after]. */
const WRAPPING_VOWELS: Record<string, [string, string]> = {
  'ෙ': ['ෙ', ''],                 // ෙ
  'ේ': ['ෙ', '්'],           // ේ
  'ෛ': ['ෛ', ''],                 // ෛ
  'ො': ['ෙ', 'ා'],           // ො
  'ෝ': ['ෙ', 'ා්'],     // ෝ
  'ෞ': ['ෙ', 'ෟ']            // ෞ
};

const ZWJ = '‍';
const HAL = '්';

const isSinhalaConsonant = (c: string) => c >= 'ක' && c <= 'ෆ';

/**
 * Rewrite Sinhala so that the PDF library draws it correctly.
 * Text with no Sinhala in it is returned unchanged.
 */
export function prepareSinhalaForPdf(text: string): string {
  if (!text) return text;
  // Joined letters cannot be built, so ask for the unjoined spelling instead.
  const src = text.replace(/‍/g, '');
  let out = '';
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    if (isSinhalaConsonant(ch)) {
      // Take the whole cluster: a letter, plus any ් + letter that follows it.
      let j = i + 1;
      while (src[j] === HAL && isSinhalaConsonant(src[j + 1])) j += 2;
      const cluster = src.slice(i, j);

      const vowel = src[j];
      const wrap = vowel ? WRAPPING_VOWELS[vowel] : undefined;
      if (wrap) {
        out += wrap[0] + cluster + wrap[1];
        i = j + 1;
        continue;
      }

      out += cluster;
      i = j;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

/** True if the text contains anything the PDF library's own fonts cannot draw. */
export function hasNonLatin(text: string): boolean {
  return /[^\u0000-ɏ]/.test(text);
}

const FONT_FILE = 'NotoSansSinhala.ttf';
/** The name to pass to doc.setFont() once the font has been added. */
export const SINHALA_FONT_NAME = 'NotoSansSinhala';

/**
 * Add the Sinhala font to a PDF, fetching it only on the first export.
 * Returns false if it could not be added, so the caller can carry on in
 * English rather than fail the whole export.
 */
export async function addSinhalaFont(doc: any): Promise<boolean> {
  try {
    const { SINHALA_FONT_BASE64 } = await import('./sinhalaFont');
    doc.addFileToVFS(FONT_FILE, SINHALA_FONT_BASE64);
    doc.addFont(FONT_FILE, SINHALA_FONT_NAME, 'normal');
    doc.addFont(FONT_FILE, SINHALA_FONT_NAME, 'bold');
    return true;
  } catch (err) {
    console.error('[PDF] Could not load the Sinhala font:', err);
    return false;
  }
}
