const axios = require('axios');

async function testFilm() {
  try {
    const res = await axios.get('https://fs17.lol/engine/ajax/film_api.php?id=15113782', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    console.log("Film response length:", JSON.stringify(res.data).substring(0, 100));
  } catch (e) {
    console.error("Film error:", e.message);
  }
}
testFilm();
