import axios from 'axios';
import * as cheerio from 'cheerio';
import { HorusProvider, SearchResult, Episode, Stream } from '../types';

export class AnimeSamaProvider implements HorusProvider {
  name = 'Anime-Sama';
  private baseUrl = 'https://anime-sama.to';
  private headers = {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
    "accept-language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
    "referer": "https://anime-sama.to/"
  };

  async search(query: string): Promise<SearchResult[]> {
    const url = `${this.baseUrl}/catalogue/`;
    const { data } = await axios.get(url, {
      params: { search: query, 'type[]': 'Anime' },
      headers: this.headers
    });
    
    const $ = cheerio.load(data);
    const results: SearchResult[] = [];
    
    $('a[href*="catalogue/"]').each((_, el) => {
      const $card = $(el);
      let title = $card.find('h2.card-title').text().trim() || $card.find('h1').text().trim();
      const href = $card.attr('href');
      let coverUrl = $card.find('img').attr('src');
      
      if (coverUrl && !coverUrl.startsWith('http')) {
        coverUrl = coverUrl.startsWith('/') ? `${this.baseUrl}${coverUrl}` : `${this.baseUrl}/${coverUrl}`;
      }
      
      if (title && href) {
        if (!results.find(r => r.title === title)) {
            let relativePath = href.replace(this.baseUrl, '');
            if (!relativePath.startsWith('/')) relativePath = '/' + relativePath;

            results.push({ id: relativePath, title, coverUrl, type: 'anime' });
        }
      }
    });
    
    return results;
  }

  async getEpisodes(mediaId: string): Promise<Episode[]> {
      const fullUrl = `${this.baseUrl}${mediaId}`.replace(/([^:]\/)\/+/g, "$1");
      const { data: pageHtml } = await axios.get(fullUrl, { headers: this.headers });
      
      const seasons: { name: string, url: string }[] = [];
      const regex = /panneauAnime\("([^"]+)",\s*"([^"]+)"\)/g;
      let match;
      while ((match = regex.exec(pageHtml)) !== null) {
          if (!match[1].toLowerCase().includes('film') && match[1].toLowerCase() !== 'nom') {
              seasons.push({ name: match[1], url: match[2] });
          }
      }
      
      if (seasons.length === 0) seasons.push({ name: "Saison Unique", url: "" });

      const allEpisodes: Episode[] = [];
      
      for (const season of seasons) {
          let seasonUrl = fullUrl.endsWith('/') ? `${fullUrl}${season.url}` : `${fullUrl}/${season.url}`;
          if (season.url.startsWith('http')) seasonUrl = season.url;
          
          // FIX: Toujours ajouter un slash à la fin des dossiers de saison pour éviter l'erreur 404 d'Anime-Sama
          if (!seasonUrl.endsWith('/')) seasonUrl += '/';
          if (season.url === "") seasonUrl = fullUrl.endsWith('/') ? fullUrl : fullUrl + '/';

          try {
              const { data: seasonHtml } = await axios.get(seasonUrl, { headers: this.headers });
              const fileverMatch = /episodes\.js\?filever=(\d+)/.exec(seasonHtml);
              
              if (fileverMatch) {
                  const episodesJsUrl = `${seasonUrl}episodes.js?filever=${fileverMatch[1]}`;
                  const { data: jsData } = await axios.get(episodesJsUrl, { headers: this.headers });
                  
                  const arrayMatches = [...jsData.matchAll(/var\s+eps\d+\s*=\s*\[(.*?)\];/gs)];
                  
                  if (arrayMatches.length > 0) {
                      let bestLinks: string[] = [];
                      for (const arrMatch of arrayMatches) {
                          const linksContent = arrMatch[1];
                          const links = [...linksContent.matchAll(/https?:\/\/[^\s'",]+/g)].map(m => m[0]);
                          if (links.length > 0) {
                              if (bestLinks.length === 0) bestLinks = links;
                              const sample = links[0].toLowerCase();
                              if (sample.includes('sibnet') || sample.includes('sendvid') || sample.includes('vidmoly')) {
                                  bestLinks = links;
                                  break;
                              }
                          }
                      }
                      
                      bestLinks.forEach((link, index) => {
                           allEpisodes.push({
                               id: `${season.name}::${link}`,
                               number: index + 1,
                               title: `${season.name} - Épisode ${index + 1}`
                           });
                      });
                  }
              }
          } catch (e) {
              console.error(`Error fetching season ${season.name}`);
          }
      }

      return allEpisodes;
  }

  async getStreams(episodeId: string): Promise<Stream[]> {
      const urlMatch = episodeId.split('::');
      const providerUrl = urlMatch.length > 1 ? urlMatch[1] : episodeId;
      const serverName = new URL(providerUrl).hostname || 'Unknown';
      
      try {
          // Parse Sibnet
          if (providerUrl.includes('sibnet.ru')) {
              const match = /videoid=(\d+)/.exec(providerUrl);
              if (match) {
                 const videoId = match[1];
                 const shellUrl = `https://video.sibnet.ru/shell.php?videoid=${videoId}`;
                 const { data } = await axios.get(shellUrl, { headers: { "user-agent": this.headers["user-agent"] } });
                 const hashMatch = /player\.src\(\[\{src: "\/v\/([^/]+)\//.exec(data);
                 if (hashMatch) {
                    return [{
                        url: `https://video.sibnet.ru/v/${hashMatch[1]}/${videoId}.mp4`,
                        quality: 'auto',
                        server: 'Sibnet'
                    }];
                 }
              }
          }
          
          // Parse Sendvid
          if (providerUrl.includes('sendvid.com')) {
             const { data } = await axios.get(providerUrl, { headers: { "user-agent": this.headers["user-agent"] } });
             const m3u8Match = /video_source\s*=\s*['"]([^'"]+\.m3u8)['"]/.exec(data);
             if (m3u8Match) {
                 return [{
                     url: m3u8Match[1],
                     quality: 'auto',
                     server: 'Sendvid'
                 }];
             }
          }
      } catch (e) {
          console.warn(`[getStreams] Le fournisseur ${serverName} a retourné une erreur (potentiellement un lien mort).`);
      }

      // Default fallback
      return [{ url: providerUrl, quality: 'unknown', server: serverName }];
  }
}
