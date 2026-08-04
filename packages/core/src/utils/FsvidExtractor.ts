const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const decodeBase64Bytes = (encoded: string): number[] | null => {
  const normalized = encoded
    .replace(/\s+/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const bytes: number[] = [];
  let accumulator = 0;
  let bitCount = 0;

  for (const character of normalized) {
    if (character === '=') break;
    const value = BASE64_ALPHABET.indexOf(character);
    if (value < 0) return null;

    accumulator = (accumulator << 6) | value;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes.push((accumulator >> bitCount) & 0xff);
      accumulator &= bitCount === 0 ? 0 : (1 << bitCount) - 1;
    }
  }

  return bytes;
};

export const isPromotionalMediaUrl = (candidate: string): boolean => {
  try {
    const url = new URL(candidate);
    const pathname = `${url.pathname.toLowerCase()}/`;
    const fullUrl = candidate.toLowerCase();
    return (
      /\/(?:troll|ads?|advert|preroll|vast)\//.test(pathname) ||
      fullUrl.includes('video_ad')
    );
  } catch {
    return true;
  }
};

const isUsableHlsUrl = (candidate: string): boolean => {
  try {
    const url = new URL(candidate);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      /\.m3u8$/i.test(url.pathname) &&
      !isPromotionalMediaUrl(candidate)
    );
  } catch {
    return false;
  }
};

/**
 * Extracts the source owned by the VideoJS `sources` entry. Fsvid currently
 * places a short `/troll/` HLS URL earlier in the unpacked script, while the
 * actual media URL is encoded in an inline base64/XOR function.
 */
export const extractFsvidHlsSource = (unpackedScript: string): string | null => {
  const sourceEntry = unpackedScript.match(
    /\bsources\s*:\s*\[\s*\{\s*src\s*:\s*([\s\S]{1,2500}?),\s*type\s*:\s*['"][^'"]+['"]/i
  );
  if (!sourceEntry) return null;

  const sourceExpression = sourceEntry[1].trim();
  const directSource = sourceExpression.match(/^['"](https?:\/\/[^'"]+)['"]$/i);
  if (directSource) {
    return isUsableHlsUrl(directSource[1]) ? directSource[1] : null;
  }

  const keyMatch = sourceExpression.match(
    /\b(?:var|let|const)\s+[A-Za-z_$][\w$]*\s*=\s*\[\s*((?:\d+\s*,\s*)*\d+)\s*\]/
  );
  const payloadMatch = sourceExpression.match(
    /\}\s*\)\s*\(\s*['"]([A-Za-z0-9+/=_-]+)['"]\s*\)\s*$/
  );
  if (!keyMatch || !payloadMatch || !/\batob\s*\(/.test(sourceExpression)) {
    return null;
  }

  const key = keyMatch[1]
    .split(',')
    .map(value => Number.parseInt(value.trim(), 10));
  if (
    key.length === 0 ||
    key.length > 256 ||
    key.some(value => !Number.isInteger(value) || value < 0 || value > 255)
  ) {
    return null;
  }

  const encryptedBytes = decodeBase64Bytes(payloadMatch[1]);
  if (!encryptedBytes) return null;

  const decoded = encryptedBytes
    .map((value, index) => String.fromCharCode(value ^ key[index % key.length]))
    .join('');
  return isUsableHlsUrl(decoded) ? decoded : null;
};
