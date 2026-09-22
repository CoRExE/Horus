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
      headers: this.headers,
      timeout: 15_000
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

            results.push({ id: relativePath, title, coverUrl, type: 'anime', providerId: 'anime-sama' });
        }
      }
    });
    
    return results;
  }

  async getEpisodes(mediaId: string): Promise<Episode[]> {
      const fullUrl = `${this.baseUrl}${mediaId}`.replace(/([^:]\/)\/+/g, "$1");
      const { data: pageHtml } = await axios.get(fullUrl, { headers: this.headers, timeout: 15_000 });
      
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
              const { data: seasonHtml } = await axios.get(seasonUrl, { headers: this.headers, timeout: 15_000 });
              const allProviderArrays = await this.readEpisodeArrays(seasonUrl, seasonHtml);
              const maxEps = Math.max(0, ...allProviderArrays.map(a => a.length));
              for (let i = 0; i < maxEps; i++) {
                  const urlsForEp = allProviderArrays.map(arr => arr[i]).filter(Boolean);
                  if (!urlsForEp.length) continue;
                  allEpisodes.push({
                      // Preserve existing ids: adding VF must not reset playback history.
                      id: `${season.name}::${urlsForEp.join('|||')}`,
                      number: i + 1,
                      title: `${season.name} - Épisode ${i + 1}`,
                      sourceContext: { seasonUrl, episodeIndex: i },
                  });
              }
          } catch (e) {
              console.error(`Error fetching season ${season.name}`);
          }
      }

      return allEpisodes;
  }

  private async readEpisodeArrays(seasonUrl: string, html?: string): Promise<string[][]> {
      if (html === undefined) {
          const response = await axios.get(seasonUrl, { headers: this.headers, timeout: 8_000 });
          html = response.data;
      }
      const $ = cheerio.load(html!);
      const src = $('script[src]').toArray()
          .map(el => $(el).attr('src')!)
          .find(src => /^episodes\.js(?:\?|$)/.test(src));
      if (!src) return [];
      const { data } = await axios.get(new URL(src, seasonUrl).href, {
          headers: this.headers, timeout: 8_000,
      });
      return [...String(data).matchAll(/var\s+eps\d+\s*=\s*\[(.*?)\];/gs)].map(match => {
          // Preserve missing slots so a later episode never becomes the VF of an earlier one.
          const values = [...match[1].replace(/\/\*.*?\*\//gs, '').matchAll(
              /\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|([^,]*))\s*(?:,|$)/g
          )].filter(value => value[0].length > 0);
          return values.map(value => {
              const link = (value[1] ?? value[2] ?? '').replace(/\\\//g, '/');
              return /^https?:\/\//.test(link) ? link : '';
          });
      });
  }

  /**
   * Extract a direct stream URL from a single embed page URL.
   * Returns an array of streams (usually 0 or 1).
   */
  private async extractFromUrl(providerUrl: string, language = 'VOSTFR'): Promise<Stream[]> {
      const TIMEOUT = 8000;
      
      try {
          // Parse Sibnet without downloading the video body in JavaScript.
          if (providerUrl.includes('sibnet.ru')) {
              const idMatch = /videoid=(\d+)/.exec(providerUrl);
              if (idMatch) {
                 const videoId = idMatch[1];
                 const shellUrl = `https://video.sibnet.ru/shell.php?videoid=${videoId}`;
                 const { data } = await axios.get(shellUrl, { headers: { "user-agent": this.headers["user-agent"] }, timeout: TIMEOUT });
                 const hashMatch = /player\.src\(\[\{src: "\/v\/([^/]+)\//.exec(data);
                 if (hashMatch) {
                    const initialUrl = `https://video.sibnet.ru/v/${hashMatch[1]}/${videoId}.mp4`;
                    const sibnetHeaders = {
                        'Referer': 'https://video.sibnet.ru/',
                        'User-Agent': this.headers['user-agent']
                    };
                    // Let the native player/proxy follow Sibnet's redirect. Probing
                    // it with an Axios GET can buffer the entire MP4 in React Native.
                    return [{ url: initialUrl, language, quality: 'auto', server: 'Sibnet', headers: sibnetHeaders }];
                 }
              }
          }
          
          // Parse Sendvid
          if (providerUrl.includes('sendvid.com')) {
             const { data } = await axios.get(providerUrl, { headers: { "user-agent": this.headers["user-agent"] }, timeout: TIMEOUT });
             const m3u8Match = /video_source\s*=\s*['"]([^'"]+\.m3u8)['"]/.exec(data);
             if (m3u8Match) {
                 return [{ url: m3u8Match[1], language, quality: 'auto', server: 'Sendvid' }];
             }
          }

          // Parse Vidmoly — extract m3u8 from file:"url" pattern
          if (providerUrl.includes('vidmoly')) {
              const { data } = await axios.get(providerUrl, { headers: { "user-agent": this.headers["user-agent"] }, timeout: TIMEOUT });
              const m3u8Match = /file:\s*['"](https:\/\/[^'"]+\.m3u8[^'"]*)['"]/.exec(data);
              if (m3u8Match) {
                  return [{ url: m3u8Match[1], language, quality: 'auto', server: 'Vidmoly' }];
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
                      return [{ url: streamUrl, language, quality: 'auto', server: 'Smoothpre' }];
                  }
              }
          }
      } catch {
      }

      return [];
  }

  async getStreams(episodeId: string, episode?: Episode): Promise<Stream[]> {
      const parts = episodeId.split('::');
      if (parts.length < 2) return [];
      const context = episode?.id === episodeId ? episode.sourceContext : undefined;
      const primaryLanguage = context && /\/vf[12]?\/$/.test(context.seasonUrl) ? 'VF' : 'VOSTFR';
      const sources = parts.slice(1).join('::').split('|||')
          .filter(Boolean).map(url => ({ url, language: primaryLanguage }));

      // Fetch alternate lists only for the selected episode, not for every season in the catalogue.
      if (context && Number.isInteger(context.episodeIndex) && context.episodeIndex >= 0) {
          const seasonUrl = new URL(context.seasonUrl);
          if (seasonUrl.origin === this.baseUrl && /\/(?:vostfr|vf[12]?)\/$/.test(seasonUrl.pathname)) {
              const variants = ['vostfr', 'vf', 'vf1', 'vf2']
                  .map(lang => ({ url: new URL(`../${lang}/`, seasonUrl).href, language: lang === 'vostfr' ? 'VOSTFR' : 'VF' }))
                  .filter(variant => variant.url !== seasonUrl.href);
              const results = await Promise.allSettled(variants.map(async variant => {
                  const arrays = await this.readEpisodeArrays(variant.url);
                  return arrays.map(array => array[context.episodeIndex]).filter(Boolean)
                      .map(url => ({ url, language: variant.language }));
              }));
              for (const result of results) {
                  if (result.status === 'fulfilled') sources.push(...result.value);
              }
          }
      }
      const uniqueSources = sources.filter((source, index) => sources.findIndex(
          other => other.url === source.url && other.language === source.language
      ) === index);
      const results = await Promise.allSettled(
          uniqueSources.map(source => this.extractFromUrl(source.url, source.language))
      );
      return results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  }
}
