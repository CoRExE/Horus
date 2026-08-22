export class Unpacker {
  private static readonly MAX_SOURCE_LENGTH = 2_000_000;
  private static readonly MAX_SYMBOL_COUNT = 20_000;

  /**
   * Detects and decrypts Dean Edwards' Packer obfuscated code.
   * `eval(function(p,a,c,k,e,d){...` 
   */
  static unpack(source: string): string {
    if (source.length > Unpacker.MAX_SOURCE_LENGTH) return source;

    const regex = /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*d\s*\)\s*\{.*?\}\s*\(\s*(.*?)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'(.*?)'\.split\s*\(\s*'\|'\s*\).*?\)\s*\)/;
    
    const match = regex.exec(source);
    if (!match) return source;

    let [, p, aStr, cStr, kStr] = match;
    const a = parseInt(aStr, 10);
    let c = parseInt(cStr, 10);
    const k = kStr.split('|');

    // Dean Edwards' packer only supports radices 2..62. Reject malformed
    // provider payloads before they can trigger unbounded recursion/work.
    if (
      !Number.isInteger(a) || a < 2 || a > 62 ||
      !Number.isInteger(c) || c < 0 || c > Unpacker.MAX_SYMBOL_COUNT ||
      k.length > Unpacker.MAX_SYMBOL_COUNT || p.length > Unpacker.MAX_SOURCE_LENGTH
    ) {
      return source;
    }

    // Simple custom function to extract the string literal "p" correctly
    // It's usually a quoted string literal inside the arguments
    const pMatch = p.match(/^['"](.*)['"]$/);
    if (pMatch) p = pMatch[1];
    p = p.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');

    const e = (value: number): string => {
      let remaining = value;
      let encoded = '';
      do {
        const digit = remaining % a;
        encoded = (digit > 35
          ? String.fromCharCode(digit + 29)
          : digit.toString(36)) + encoded;
        remaining = Math.floor(remaining / a);
      } while (remaining > 0);
      return encoded;
    };

    while (c--) {
      if (k[c]) {
        const replaceRegex = new RegExp(`\\b${e(c)}\\b`, 'g');
        p = p.replace(replaceRegex, k[c]);
      }
    }

    return p;
  }
}
