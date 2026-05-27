const axios = require('axios');
async function test() {
  const { data } = await axios.get('https://fsvid.lol/embed-t1yt9vxkhgay.html', {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  console.log("Includes eval?", data.includes('eval(function'));
  console.log("Includes m3u8?", data.includes('m3u8'));
  console.log("Substring 500:", data.substring(0, 500));
}
test();
