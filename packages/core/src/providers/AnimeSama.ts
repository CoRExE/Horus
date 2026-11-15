import axios from 'axios';
import * as cheerio from 'cheerio';
import { HorusProvider, SearchResult, Episode, Stream } from '../types';
import { Unpacker } from '../utils/Unpacker';

interface EpisodeLists {
  /** One array per player, indexed by episode: embed URL, `lien:<n°>` reference or '' for a gap. */
  arrays: string[][];
  /** Page token for /api/lien.php (valid about 24 h). */
  token?: string;
  /** Per link number: host and, when the host deleted the video, state 1 or 2. */
  meta: Record<string, [string, number?]>;
}

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
      let title = $card.find('h3.as-carte-titre').text().trim() ||
        $card.find('h2.card-title').text().trim() || $card.find('h1').text().trim();
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
              const { arrays: allProviderArrays } = await this.readEpisodeLists(seasonUrl, String(seasonHtml));
              const maxEps = Math.max(0, ...allProviderArrays.map(a => a.length));
              for (let i = 0; i < maxEps; i++) {
                  const urlsForEp = allProviderArrays.map(arr => arr[i]).filter(Boolean);
                  if (!urlsForEp.length) continue;
                  allEpisodes.push({
                      // Keep every source reference in ids, including retired hosts: older ids hold
                      // embed URLs, ids since the 12/11/2026 layout hold `lien:<n°>` references.
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

  /**
   * Read a season page's episode lists. Since 12/11/2026 they are inline (`var eps1 = ["lien:2433", …]`)
   * with `epsMeta` (host and state per link) and `epsJeton`, the page token that /api/lien.php needs
   * to return a link's embed URL. Older pages load the same arrays, with full URLs, from episodes.js.
   */
  private async readEpisodeLists(seasonUrl: string, html?: string): Promise<EpisodeLists> {
      if (html === undefined) {
          const response = await axios.get(seasonUrl, { headers: this.headers, timeout: 8_000 });
          html = String(response.data);
      }
      if (/\bvar\s+eps\d+\s*=\s*\[/.test(html)) {
          let meta: EpisodeLists['meta'] = {};
          try {
              const json = /\bvar\s+epsMeta\s*=\s*(\{.*?\})\s*;/s.exec(html)?.[1];
              if (json) meta = JSON.parse(json);
          } catch {
          }
          return {
              arrays: this.parseEpisodeArrays(html),
              token: /\bvar\s+epsJeton\s*=\s*["']([^"']+)["']/.exec(html)?.[1],
              meta,
          };
      }
      const $ = cheerio.load(html);
      const src = $('script[src]').toArray()
          .map(el => $(el).attr('src')!)
          .find(src => /^episodes\.js(?:\?|$)/.test(src));
      if (!src) return { arrays: [], meta: {} };
      const { data } = await axios.get(new URL(src, seasonUrl).href, {
          headers: this.headers, timeout: 8_000,
      });
      return { arrays: this.parseEpisodeArrays(String(data)), meta: {} };
  }

  private parseEpisodeArrays(script: string): string[][] {
      return [...script.matchAll(/var\s+eps\d+\s*=\s*\[(.*?)\];/gs)].map(match => {
          // Preserve missing slots so a later episode never becomes the VF of an earlier one.
          const values = [...match[1].replace(/\/\*.*?\*\//gs, '').matchAll(
              /\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|([^,]*))\s*(?:,|$)/g
          )].filter(value => value[0].length > 0);
          return values.map(value => {
              const link = (value[1] ?? value[2] ?? '').replace(/\\\//g, '/');
              return /^https?:\/\//.test(link) || /^lien:\d+$/.test(link) ? link : '';
          });
      });
  }

  /** Whether an embed host has an extractor; other links are not even resolved. */
  private isSupportedHost(host: string): boolean {
      const name = host.toLowerCase();
      return name.includes('sendvid') || this.jwPlayerHosts.some(item => name.includes(item.match));
  }

  /** Turn a `lien:<n°>` reference into its embed URL with the page token, skipping dead or unsupported links. */
  private async resolveLink(reference: string, lists: EpisodeLists, refererUrl: string): Promise<string | undefined> {
      if (/^https?:\/\//.test(reference)) return reference;
      const id = /^lien:(\d+)$/.exec(reference)?.[1];
      if (!id || !lists.token) return undefined;
      const [host, state] = lists.meta[id] ?? [];
      // State 1 or 2: the host deleted the video.
      if (state === 1 || state === 2 || (host && !this.isSupportedHost(host))) return undefined;
      const query = new URLSearchParams({ j: lists.token, l: id });
      const { data } = await axios.get(`${this.baseUrl}/api/lien.php?${query}`, {
          headers: { ...this.headers, referer: refererUrl, accept: 'application/json' }, timeout: 8_000,
      });
      const answer = typeof data === 'string' ? JSON.parse(data) : data;
      const url = typeof answer?.u === 'string' ? answer.u : '';
      return /^https?:\/\//.test(url) ? url : undefined;
  }

  private jwPlayerHosts = [
      { match: 'vidmoly', server: 'Vidmoly' },
      { match: 'smoothpre', server: 'Smoothpre' },
      { match: 'uqload', server: 'Uqload' },
      { match: 'ansembed', server: 'Ansembed' },
  ];

  /** Read the HLS source of a JW Player embed page without running its scripts. */
  private readJwPlayerSource(html: string, embedUrl: string): string | undefined {
      const script = html.includes('eval(function') ? `${html}\n${Unpacker.unpack(html)}` : html;

      // Smoothpre lists several mirrors: `var links={"hls4":"/stream/…","hls2":"https://…"}`.
      // hls4 (relative to the embed host) is the player's first choice; hls3 mirrors may be unreachable.
      const linksMatch = /var\s+links\s*=\s*(\{.*?\})\s*;/s.exec(script);
      if (linksMatch) {
          try {
              const links: Record<string, unknown> = JSON.parse(linksMatch[1]);
              for (const key of ['hls4', 'hls2', 'hls3']) {
                  const link = links[key];
                  if (typeof link === 'string' && link) {
                      return new URL(link, embedUrl).href.replace(/\.txt(?=$|\?)/, '.m3u8');
                  }
              }
          } catch {
          }
      }

      const fileMatch = /file:\s*['"](https?:\/\/[^'"]+\.m3u8[^'"]*)['"]/.exec(script)
          ?? /['"](https?:\/\/[^'"]+\.(?:m3u8|txt)[^'"]*)['"]/.exec(script);
      return fileMatch?.[1].replace(/\.txt(?=$|\?)/, '.m3u8');
  }

  /**
   * Extract a direct stream URL from a single embed page URL.
   * Returns an array of streams (usually 0 or 1).
   */
  private async extractFromUrl(providerUrl: string, language = 'VOSTFR'): Promise<Stream[]> {
      const TIMEOUT = 8000;
      
      try {
          // Parse Sendvid
          if (providerUrl.includes('sendvid.com')) {
             const { data } = await axios.get(providerUrl, { headers: { "user-agent": this.headers["user-agent"] }, timeout: TIMEOUT });
             const m3u8Match = /video_source\s*=\s*['"]([^'"]+\.m3u8)['"]/.exec(data);
             if (m3u8Match) {
                 return [{ url: m3u8Match[1], language, quality: 'auto', server: 'Sendvid' }];
             }
          }

          // JW Player embeds (Vidmoly, Smoothpre, Uqload, Ansembed), optionally packed with Dean Edwards' packer
          const playerHost = this.jwPlayerHosts.find(host => providerUrl.toLowerCase().includes(host.match));
          if (playerHost) {
              const { data } = await axios.get(providerUrl, { headers: { "user-agent": this.headers["user-agent"] }, timeout: TIMEOUT });
              const streamUrl = this.readJwPlayerSource(String(data), providerUrl);
              if (streamUrl) {
                  return [{ url: streamUrl, language, quality: 'auto', server: playerHost.server }];
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
      const references = parts.slice(1).join('::').split('|||').filter(Boolean);
      // Embed URLs (ids before 12/11/2026) are used as they are; `lien:` references need a page token.
      const sources = references.filter(url => /^https?:\/\//.test(url))
          .map(url => ({ url, language: primaryLanguage }));

      // Read the season pages only for the selected episode, not for every season in the catalogue.
      if (context && Number.isInteger(context.episodeIndex) && context.episodeIndex >= 0) {
          const seasonUrl = new URL(context.seasonUrl);
          const pages = [{ url: seasonUrl.href, language: primaryLanguage }];
          if (seasonUrl.origin === this.baseUrl && /\/(?:vostfr|vf[12]?)\/$/.test(seasonUrl.pathname)) {
              pages.push(...['vostfr', 'vf', 'vf1', 'vf2']
                  .map(lang => ({ url: new URL(`../${lang}/`, seasonUrl).href, language: lang === 'vostfr' ? 'VOSTFR' : 'VF' }))
                  .filter(variant => variant.url !== seasonUrl.href));
          }
          // The original page is needed only when the id holds references; the URLs above already cover it.
          const toRead = references.some(reference => reference.startsWith('lien:')) ? pages : pages.slice(1);
          const results = await Promise.allSettled(toRead.map(async page => {
              const lists = await this.readEpisodeLists(page.url);
              const links = await Promise.allSettled(lists.arrays
                  .map(array => array[context.episodeIndex]).filter(Boolean)
                  .map(reference => this.resolveLink(reference, lists, page.url)));
              return links.flatMap(link => link.status === 'fulfilled' && link.value
                  ? [{ url: link.value, language: page.language }] : []);
          }));
          for (const result of results) {
              if (result.status === 'fulfilled') sources.push(...result.value);
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
