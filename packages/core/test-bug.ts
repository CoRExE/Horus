import axios from 'axios';
axios.get('https://anime-sama.to/catalogue/my-hero-academia/').then(r => {
    const html = r.data;
    console.log("Episodes.js in pageHtml?", html.includes('episodes.js'));
    console.log("filever in pageHtml?", html.includes('filever'));
}).catch(console.error);
