const axios = require('axios');
const cheerio = require('cheerio');

async function testSearch() {
  const formData = new URLSearchParams();
  formData.append('query', 'batman');

  const { data } = await axios.post('https://fs17.lol/engine/ajax/search.php', formData, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' }
  });
  
  const $ = cheerio.load(data);
  const results = [];
  
  $('.search-item').each((_, el) => {
    const $el = $(el);
    const onclick = $el.attr('onclick');
    if (!onclick) return;
    const hrefMatch = onclick.match(/location\.href='([^']+)'/);
    if (!hrefMatch) return;
    const href = hrefMatch[1];
    const idMatch = href.match(/\/(\d+)-/);
    results.push({ href, id: idMatch ? idMatch[1] : null });
  });
  console.log(results.slice(0, 3));
}
testSearch();
