const axios = require('axios');
async function test() {
  try {
    const { data } = await axios.get('https://fsvid.lol/embed-t1yt9vxkhgay.html', {
      headers: { 
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://fs17.lol/'
      }
    });
    console.log("Success! Starts with:", data.substring(0, 100));
  } catch (e) {
    console.log("Still failed with:", e.response ? e.response.status : e.message);
  }
}
test();
