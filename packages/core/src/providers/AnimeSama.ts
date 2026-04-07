import axios from 'axios';
import * as cheerio from 'cheerio';
import { HorusProvider, SearchResult, Episode, Stream } from '../types';
import { Unpacker } from '../utils/Unpacker';

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
                      // Collect ALL provider arrays (not just the "best" one)
                      const allProviderArrays: string[][] = [];
                      for (const arrMatch of arrayMatches) {
                          const linksContent = arrMatch[1];
                          const links = [...linksContent.matchAll(/https?:\/\/[^\s'",]+/g)].map(m => m[0]);
                          if (links.length > 0) {
                              allProviderArrays.push(links);
                          }
                      }
                      
                      // Determine episode count from the longest provider array
                      const maxEps = Math.max(...allProviderArrays.map(a => a.length));
                      
                      for (let i = 0; i < maxEps; i++) {
                          // Collect all provider URLs for this specific episode index
                          const urlsForEp = allProviderArrays
                              .filter(arr => arr[i])
                              .map(arr => arr[i]);
                          
                          allEpisodes.push({
                              id: `${season.name}::${urlsForEp.join('|||')}`,
                              number: i + 1,
                              title: `${season.name} - Épisode ${i + 1}`
                          });
                      }
                  }
              }
          } catch (e) {
              console.error(`Error fetching season ${season.name}`);
          }
      }

      return allEpisodes;
  }

  /**
   * Extract a direct stream URL from a single embed page URL.
   * Returns an array of streams (usually 0 or 1).
   */
  private async extractFromUrl(providerUrl: string): Promise<Stream[]> {
      const TIMEOUT = 8000;
      
      try {
          // Parse Sibnet — follow the 302 redirect to get the actual CDN URL
          if (providerUrl.includes('sibnet.ru')) {
              const idMatch = /videoid=(\d+)/.exec(providerUrl);
              if (idMatch) {
                 const videoId = idMatch[1];
                 const shellUrl = `https://video.sibnet.ru/shell.php?videoid=${videoId}`;
                 const { data } = await axios.get(shellUrl, { headers: { "user-agent": this.headers["user-agent"] }, timeout: TIMEOUT });
                 const hashMatch = /player\.src\(\[\{src: "\/v\/([^/]+)\//.exec(data);
                 if (hashMatch) {
                    const initialUrl = `https://video.sibnet.ru/v/${hashMatch[1]}/${videoId}.mp4`;
                    const sibnetHeaders = { 'Referer': 'https://video.sibnet.ru/' };
                    try {
                        const redirectRes = await axios.get(initialUrl, {
                            headers: { "user-agent": this.headers["user-agent"], "range": "bytes=0-", "accept-encoding": "identity", "referer": "https://video.sibnet.ru/" },
                            maxRedirects: 0,
                            validateStatus: (status) => status >= 200 && status < 400,
                            timeout: TIMEOUT
                        });
                        if (redirectRes.status === 302 && redirectRes.headers.location) {
                            return [{ url: redirectRes.headers.location, quality: 'auto', server: 'Sibnet', headers: sibnetHeaders }];
                        }
                    } catch (e: any) {
                        if (e.response?.status === 302 && e.response?.headers?.location) {
                            return [{ url: e.response.headers.location, quality: 'auto', server: 'Sibnet', headers: sibnetHeaders }];
                        }
                    }
                    return [{ url: initialUrl, quality: 'auto', server: 'Sibnet', headers: sibnetHeaders }];
                 }
              }
          }
          
          // Parse Sendvid
          if (providerUrl.includes('sendvid.com')) {
             const { data } = await axios.get(providerUrl, { headers: { "user-agent": this.headers["user-agent"] }, timeout: TIMEOUT });
             const m3u8Match = /video_source\s*=\s*['"]([^'"]+\.m3u8)['"]/.exec(data);
             if (m3u8Match) {
                 return [{ url: m3u8Match[1], quality: 'auto', server: 'Sendvid' }];
             }
          }

          // Parse Vidmoly — extract m3u8 from file:"url" pattern
          if (providerUrl.includes('vidmoly')) {
              const { data } = await axios.get(providerUrl, { headers: { "user-agent": this.headers["user-agent"] }, timeout: TIMEOUT });
              const m3u8Match = /file:\s*['"](https:\/\/[^'"]+\.m3u8[^'"]*)['"]/.exec(data);
              if (m3u8Match) {
                  return [{ url: m3u8Match[1], quality: 'auto', server: 'Vidmoly' }];
              }
          }

          // Parse Smoothpre — Dean Edwards JS packer decryption
          if (providerUrl.toLowerCase().includes('smoothpre')) {
              const { data } = await axios.get(providerUrl, { headers: { "user-agent": this.headers["user-agent"] }, timeout: TIMEOUT });
              if (data.includes('eval(function')) {
                  const decrypted = Unpacker.unpack(data);
                  const m3u8Match = /['"](https?:\/\/[^'"]+\.(?:m3u8|txt)[^'"]*)['"]/.exec(decrypted);
                  if (m3u8Match) {
                      let streamUrl = m3u8Match[1];
                      if (streamUrl.includes('.txt')) streamUrl = streamUrl.replace('.txt', '.m3u8');
                      return [{ url: streamUrl, quality: 'auto', server: 'Smoothpre' }];
                  }
              }
          }
      } catch {
      }

      return [];
  }

  async getStreams(episodeId: string): Promise<Stream[]> {
      const parts = episodeId.split('::');
      if (parts.length < 2) return [];
      
      const urlsPart = parts.slice(1).join('::');
      const providerUrls = urlsPart.split('|||');
      
      const results = await Promise.allSettled(
          providerUrls.map(url => this.extractFromUrl(url))
      );
      
      const streams: Stream[] = [];
      for (const result of results) {
          if (result.status === 'fulfilled' && result.value.length > 0) {
              streams.push(...result.value);
          }
      }
      

      
      return streams;
  }
}
