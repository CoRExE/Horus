export class Unpacker {
  /**
   * Detects and decrypts Dean Edwards' Packer obfuscated code.
   * `eval(function(p,a,c,k,e,d){...` 
   */
  static unpack(source: string): string {
    const regex = /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*d\s*\)\s*\{.*?\}\s*\(\s*(.*?)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'(.*?)'\.split\s*\(\s*'\|'\s*\).*?\)\s*\)/;
    
    const match = regex.exec(source);
    if (!match) return source;

    let [, p, aStr, cStr, kStr] = match;
    const a = parseInt(aStr, 10);
    let c = parseInt(cStr, 10);
    const k = kStr.split('|');

    // Simple custom function to extract the string literal "p" correctly
    // It's usually a quoted string literal inside the arguments
    const pMatch = p.match(/^['"](.*)['"]$/);
    if (pMatch) p = pMatch[1];
    p = p.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');

    const e = (c: number): string => {
      return (
        (c < a ? '' : e(Math.floor(c / a))) +
        ((c % a) > 35 ? String.fromCharCode((c % a) + 29) : (c % a).toString(36))
      );
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
