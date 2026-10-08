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

const readMeasuredWidth = (expression: string, widthVariable: string): number | null => {
  const measurement = expression.match(
    /\b([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\.offsetWidth\s*\|\s*0\b/
  );
  if (measurement?.[1] !== widthVariable) return null;
  const escaped = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const styleFor = (name: string): Map<string, string> | null => {
    const style = expression.match(new RegExp(
      `${escaped(name)}\\.style\\.cssText\\s*=\\s*(['"])([^'"\\r\\n]{1,1000})\\1`
    ))?.[2];
    if (!style) return null;
    const properties = new Map<string, string>();
    for (const declaration of style.split(';').filter(value => value.trim())) {
      const pair = declaration.match(/^\s*([a-z-]+)\s*:\s*([^:]+?)\s*$/i);
      if (!pair || properties.has(pair[1].toLowerCase())) return null;
      properties.set(pair[1].toLowerCase(), pair[2]);
    }
    return properties;
  };
  const plainBox = (style: Map<string, string>) => {
    const supported = ['position', 'visibility', 'left', 'padding', 'border', 'margin', 'width', 'height'];
    return [...style.keys()].every(key => supported.includes(key)) &&
      /^0(?:px)?$/.test(style.get('padding') || '') && /^0(?:px)?$/.test(style.get('border') || '');
  };
  const resolve = (name: string, visited: Set<string>, nested: boolean): number | null => {
    if (visited.has(name) || visited.size >= 8) return null;
    visited.add(name);
    const style = styleFor(name);
    if (!style || (nested && !plainBox(style))) return null;
    const width = style.get('width');
    // CSS defines one inch as 96 pixels. Read offsets from the actual style.
    if (width === '1in') return 96;
    const calc = width?.match(/^calc\(\s*1in\s+([+-])\s+(\d{1,4})px\s*\)$/i);
    if (calc) return 96 + (calc[1] === '+' ? 1 : -1) * Number(calc[2]);
    const percent = width?.match(/^(\d{1,3}(?:\.\d{1,2})?)%$/);
    if (!percent || Number(percent[1]) <= 0 || Number(percent[1]) > 100 || !plainBox(style)) return null;
    const parents = Array.from(expression.matchAll(new RegExp(
      `([A-Za-z_$][\\w$]*)\\.appendChild\\(\\s*${escaped(name)}\\s*\\)`, 'g'
    )), match => match[1]);
    if (parents.length !== 1) return null;
    const parentWidth = resolve(parents[0], visited, true);
    return parentWidth !== null && parentWidth > 0 && parentWidth <= 10_000
      ? parentWidth * Number(percent[1]) / 100 : null;
  };
  const measured = resolve(measurement[2], new Set(), false);
  // The observed percentage layouts yield exact integer pixels. Reject other
  // layouts rather than guessing browser rounding, borders or containing blocks.
  return measured !== null && Number.isInteger(measured) && measured > 0 && measured <= 10_000
    ? measured : null;
};

/**
 * Extracts the source owned by the VideoJS `sources` entry. Fsvid currently
 * places a short `/troll/` HLS URL earlier in the unpacked script, while the
 * actual media URL is encoded in an inline base64/XOR function.
 */
export const extractFsvidHlsSource = (
  unpackedScript: string,
  sourceHostname?: string
): string | null => {
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
  if (!payloadMatch || !/\batob\s*\(/.test(sourceExpression)) {
    return null;
  }

  const encryptedBytes = decodeBase64Bytes(payloadMatch[1]);
  if (!encryptedBytes) return null;

  const rotatingKey = sourceExpression.match(
    /0x3d\s*\+\s*[A-Za-z_$][\w$]*\s*\*\s*89\s*\+\s*[A-Za-z_$][\w$]*(?:\s*\+\s*([A-Za-z_$][\w$]*))?\s*\)\s*&\s*255/
  );

  if (
    sourceHostname &&
    /\.reverse\s*\(\s*\)\s*\.join\s*\(\s*['"]{2}\s*\)/.test(sourceExpression) &&
    rotatingKey
  ) {
    let browserWidth = 0;
    if (rotatingKey[1]) {
      const measuredWidth = readMeasuredWidth(sourceExpression, rotatingKey[1]);
      if (measuredWidth === null) return null;
      browserWidth = measuredWidth;
    }
    const hostnameKey = Array.from(sourceHostname.toLowerCase()).reduce(
      (sum, character) => (sum + character.charCodeAt(0)) & 0xff,
      0
    );
    const decoded = [...encryptedBytes]
      .reverse()
      .map((value, index) =>
        String.fromCharCode(value ^ ((0x3d + index * 89 + hostnameKey + browserWidth) & 0xff))
      )
      .join('');
    if (isUsableHlsUrl(decoded)) return decoded;
  }

  if (!keyMatch) return null;

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

  const decoded = encryptedBytes
    .map((value, index) => String.fromCharCode(value ^ key[index % key.length]))
    .join('');
  return isUsableHlsUrl(decoded) ? decoded : null;
};
