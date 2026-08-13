import { HttpClient } from '../src/utils/HttpClient';
import { Unpacker } from '../../../packages/core/src/utils/Unpacker';

async function test() {
  const http = HttpClient.create('https://uqload.is');
  try {
    const res = await http.get('/embed-kkaggk8k25p9.html', {
      headers: { 'Referer': 'https://fs17.lol/' }
    });
    
    // Check for unpacked script
    let decrypted = res.data;
    if (res.data.includes('eval(function')) {
      const match = res.data.match(/eval\(function[\s\S]*?\n<\/script>/);
      if (match) {
        decrypted = Unpacker.unpack(match[0]);
        console.log("Successfully unpacked!");
      } else {
        // sometimes it's inline without newline
        const m2 = res.data.match(/eval\(function.*?\)\)/);
        if (m2) {
           decrypted = Unpacker.unpack(m2[0]);
           console.log("Successfully unpacked m2!");
        }
      }
    }
    
    const sourceMatch = decrypted.match(/sources:\s*\[\s*\{\s*(?:file|src):\s*"([^"]+)"/);
    const sourceMatch2 = decrypted.match(/sources:\s*\[\{file:"([^"]+)"/);
    console.log("Match 1:", sourceMatch ? sourceMatch[1] : "NO MATCH");
    console.log("Match 2:", sourceMatch2 ? sourceMatch2[1] : "NO MATCH");
    
    // Or just look for m3u8
    const m3u8 = decrypted.match(/https?:\/\/[^"']+\.m3u8[^"']*/);
    console.log("M3U8:", m3u8 ? m3u8[0] : "NO MATCH");
    
  } catch (e) {
    console.log("Error:", e.message);
  }
}
test();
