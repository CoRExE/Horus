const regex = /https:\/\/fs[^/"]+\.lol/;
const html = '<a href="https://fs17.lol" class="tv-btn" target="_blank" rel="noopener">';
console.log(html.match(regex));
