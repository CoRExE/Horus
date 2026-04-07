import { HorusProvider, SearchResult, Episode, Stream } from '../types';
import { HttpClient } from '../utils/HttpClient';
import { Unpacker } from '../utils/Unpacker';
import * as cheerio from 'cheerio';

export class FrenchStreamProvider implements HorusProvider {
  name = 'French-Stream';
  private baseUrl = 'https://french-stream.lol';
  private http = HttpClient.create(this.baseUrl, 'https://fstream.info/');

  private async resolveBaseUrl() {
    try {
      const { data } = await HttpClient.create().get('https://fstream.info/');
      const match = data.match(/https:\/\/fs[^/"]+\.lol/);
      if (match) {
        this.baseUrl = match[0];
        this.http = HttpClient.create(this.baseUrl, 'https://fstream.info/');
      }
    } catch (e) {
      console.warn("Could not resolve French-Stream base url, using fallback", this.baseUrl);
    }
  }

  async search(query: string): Promise<SearchResult[]> {
    await this.resolveBaseUrl();
    
    const formData = new URLSearchParams();
    formData.append('do', 'search');
    formData.append('subaction', 'search');
    formData.append('search_start', '0');
    formData.append('full_search', '0');
    formData.append('result_from', '1');
    formData.append('story', query);

    const { data } = await this.http.get('/', {
      params: formData
    });

    const $ = cheerio.load(data);
    const results: SearchResult[] = [];

    $('a.short-poster').each((_, el) => {
      const $el = $(el);
      const href = $el.attr('href');
      const title = $el.attr('alt') || $el.find('img').attr('alt') || $el.parent().text().trim();
      let coverUrl = $el.find('img').attr('src');
      if (coverUrl && coverUrl.startsWith('/')) {
        coverUrl = `${this.baseUrl}${coverUrl}`;
      }

      if (href) {
        const pathParts = href.split('/');
        const filePart = pathParts[pathParts.length - 1];
        const idMatch = filePart.match(/^(\d+)-/);
        
        if (idMatch && title) {
          const id = idMatch[1];
          if (!results.find(r => r.id === id)) {
            results.push({
              id,
              title,
              coverUrl,
              type: href.includes('film') ? 'movie' : 'series'
            });
          }
        }
      }
    });

    return results;
  }

  async getEpisodes(mediaId: string): Promise<Episode[]> {
    await this.resolveBaseUrl();

    const apiResponse = await this.http.get(`/engine/ajax/film_api.php?id=${mediaId}`);
    const apiData = typeof apiResponse.data === 'string' ? JSON.parse(apiResponse.data) : apiResponse.data;

    if (apiData && typeof apiData === 'object' && apiData.players && Object.keys(apiData.players).length > 0) {
      return [{ id: `${mediaId}::movie`, number: 1, title: 'Film' }];
    }

    try {
      const epResponse = await this.http.get(`/ep-data.php?id=${mediaId}`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
      const epData = typeof epResponse.data === 'string' ? JSON.parse(epResponse.data) : epResponse.data;
      
      const episodesSet = new Set<string>();

      for (const lang of Object.keys(epData)) {
         if (lang === 'info') continue;
         const langData = epData[lang];
         for (const ep_no of Object.keys(langData)) {
            episodesSet.add(ep_no);
         }
      }

      return Array.from(episodesSet)
        .sort((a, b) => parseInt(a) - parseInt(b))
        .map(ep => ({
           id: `${mediaId}::${ep}`,
           number: ep,
           title: `Épisode ${ep}`
        }));
    } catch (e) {
      console.error(e);
      return [];
    }
  }

  async getStreams(episodeId: string): Promise<Stream[]> {
    await this.resolveBaseUrl();
    const [mediaId, epNo] = episodeId.split('::');
    const streams: Stream[] = [];

    let providersToScrape: { lang: string; providerName: string; embedUrl: string }[] = [];

    if (epNo === 'movie') {
       const apiResponse = await this.http.get(`/engine/ajax/film_api.php?id=${mediaId}`);
       const apiData = typeof apiResponse.data === 'string' ? JSON.parse(apiResponse.data) : apiResponse.data;

       if (apiData.players) {
          for (const providerName of Object.keys(apiData.players)) {
             for (const lang of Object.keys(apiData.players[providerName])) {
                 const embedUrl = apiData.players[providerName][lang];
                 if (embedUrl) providersToScrape.push({ lang, providerName, embedUrl });
             }
          }
       }
    } else {
       const epResponse = await this.http.get(`/ep-data.php?id=${mediaId}`, {
          headers: { 'X-Requested-With': 'XMLHttpRequest' }
       });
       const epData = typeof epResponse.data === 'string' ? JSON.parse(epResponse.data) : epResponse.data;

       for (const lang of Object.keys(epData)) {
          if (lang === 'info') continue;
          if (epData[lang][epNo]) {
             for (const providerName of Object.keys(epData[lang][epNo])) {
                const embedUrl = epData[lang][epNo][providerName];
                if (embedUrl) providersToScrape.push({ lang, providerName, embedUrl });
             }
          }
       }
    }

    // Resolve direct links concurrently
    await Promise.allSettled(providersToScrape.map(async ({ lang, providerName, embedUrl }) => {
        try {
            const rawEmbedUrl = embedUrl.startsWith('//') ? `https:${embedUrl}` : embedUrl;
            let actualEmbed = rawEmbedUrl;

            // Follow Kakaflix redirects (skip moon/bigwar = Doodstream)
            if (actualEmbed.includes('kakaflix.lol') && !actualEmbed.includes('/moon') && !actualEmbed.includes('/bigwar')) {
                const initRes = await this.http.get(actualEmbed, { timeout: 10000 });
                const redirectMatch = initRes.data.match(/window\.location\.href\s*=\s*'([^']+)'/);
                if (redirectMatch) {
                    actualEmbed = redirectMatch[1];
                } else {
                    return;
                }
            }

            // Skip known unsupported providers (Cloudflare/WASM protected)
            const unsupported = ['mixdrop', 'dood', 'dsvplay', 'kakaflix.lol/moon', 'kakaflix.lol//bigwar', 'filmoon'];
            if (unsupported.some(p => actualEmbed.includes(p))) return;

            const { data: pageHtml } = await this.http.get(actualEmbed, { timeout: 10000 });

            if (actualEmbed.includes('uqload')) {
                const match = pageHtml.match(/sources:\s*\[\s*"([^"]+)"/);
                if (match) {
                    streams.push({ url: match[1], quality: lang.toUpperCase(), server: 'Uqload', headers: { 'Referer': 'https://uqload.is/' } });
                }
            } else if (actualEmbed.includes('voe.') || actualEmbed.includes('sandratableother.com')) {
                const m1 = pageHtml.match(/var source\s*=\s*'([^']+)'/);
                const m2 = pageHtml.match(/(?:hls|mp4)':\s*'([^']+)'/);
                const link = m1 ? m1[1] : (m2 ? m2[1] : null);
                if (link) {
                   streams.push({ url: link, quality: lang.toUpperCase(), server: 'Voe', headers: { 'Referer': 'https://voe.sx/' } });
                }
            } else if (actualEmbed.includes('vidzy.live') || actualEmbed.includes('fsvid.lol')) {
                if (pageHtml.includes('eval(function')) {
                    const decrypted = Unpacker.unpack(pageHtml);
                    const linkMatch = decrypted.match(/(http[^"']+m3u8[^"']*)/) || decrypted.match(/(?:file|src):\s*['"]([^'"]+)['"]/);
                    if (linkMatch && linkMatch[1]) {
                        streams.push({ url: linkMatch[1], quality: lang.toUpperCase(), server: 'Vidzy', headers: { 'Referer': 'https://french-stream.one/' } });
                    }
                }
            }
        } catch {}
    }));

    return streams;
  }
}
