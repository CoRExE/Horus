import { Episode, HorusProvider, SearchResult, Stream } from '../types';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { extractFsvidHlsSource, isPromotionalMediaUrl } from '../utils/FsvidExtractor';
import { HttpClient } from '../utils/HttpClient';
import { Unpacker } from '../utils/Unpacker';

interface VidzySeason {
  season: number;
  episodes: number[];
}

interface VidzyAvailability {
  available: boolean;
  tmdb_id: number;
  detectedType: 'movie' | 'tv';
  title: string;
  year?: number;
  poster?: string;
  languages?: string[];
  seasons?: VidzySeason[];
}

interface HorusCatalogResponse {
  results?: SearchResult[];
}

const VIDZY_ORIGIN = 'https://vidzy.org';
const VIDZY_EMBED_ORIGIN = 'https://vidzy.cc';
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36';
const WRAPPER_HEADERS = { 'User-Agent': BROWSER_USER_AGENT, Referer: 'https://api.vidzy.org/' };
const MAX_FALLBACK_SEASONS = 100;

const encodeMediaId = (tmdbId: string) => `vidzy::${tmdbId}`;

const parseMediaId = (mediaId: string) => {
  const match = mediaId.match(/^vidzy::(\d+)$/);
  if (!match) throw new Error('Identifiant Vidzy invalide');
  return match[1];
};

const readPlayerConfig = (html: string): Record<string, unknown> | null => {
  const json = html.match(/\b(?:var|let|const)\s+CFG\s*=\s*(\{[\s\S]{1,12000}?\})\s*;/)?.[1];
  if (!json) return null;
  try {
    const config = JSON.parse(json);
    return config && typeof config === 'object' && !Array.isArray(config) ? config : null;
  } catch {
    return null;
  }
};

export const extractVidzySeriesSeason = (html: string, tmdbId: string, season: number): VidzySeason | null => {
  const config = readPlayerConfig(html);
  if (config?.type !== 'tv' || config.season !== season || !Array.isArray(config.episodes)) return null;
  if (config.baseSerie !== `${VIDZY_ORIGIN}/serie/${tmdbId}/${season}`) return null;
  const episodes = [...new Set(config.episodes.filter((value): value is number =>
    Number.isSafeInteger(value) && value > 0
  ))].sort((a, b) => a - b);
  return episodes.length ? { season, episodes } : null;
};

/** Old history may contain a film episode under a series catalogue entry. */
export const isVidzyEpisodeForMedia = (episodeId: string, media: Pick<SearchResult, 'type'>): boolean => {
  return media.type === 'series' ? /^vidzy::tv::\d+::\d+::\d+$/.test(episodeId)
    : media.type === 'movie' && /^vidzy::movie::\d+$/.test(episodeId);
};

const isVidzyHost = (hostname: string) =>
  hostname === 'vidzy.cc' || hostname.endsWith('.vidzy.cc');

const isUsableVidzyHls = (candidate: string) => {
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' &&
      isVidzyHost(url.hostname.toLowerCase()) &&
      /\.m3u8$/i.test(url.pathname) &&
      !isPromotionalMediaUrl(candidate);
  } catch {
    return false;
  }
};

export const extractVidzyIframeUrl = (wrapperHtml: string): string | null => {
  const candidate = wrapperHtml
    .match(/<iframe[^>]+\bsrc\s*=\s*["']([^"']+)["']/i)?.[1]
    ?.replace(/&amp;/g, '&');
  if (!candidate) return null;

  try {
    const url = new URL(candidate, VIDZY_ORIGIN);
    return url.protocol === 'https:' && isVidzyHost(url.hostname.toLowerCase())
      ? url.toString()
      : null;
  } catch {
    return null;
  }
};

export const extractVidzyHlsSource = (
  embedHtml: string,
  embedHostname: string
): string | null => {
  const unpacked = Unpacker.unpack(embedHtml);
  const candidates = [
    extractFsvidHlsSource(unpacked, embedHostname),
    unpacked.match(/(?:file|src)\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)/i)?.[1],
    ...Array.from(
      unpacked.matchAll(/(https?:\/\/[^"'\s]+?\.m3u8[^"'\s]*)/gi),
      match => match[1]
    ),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find(isUsableVidzyHls) || null;
};

export class VidzyProvider implements HorusProvider {
  name = 'Vidzy';
  private vidzyHttp = HttpClient.create(VIDZY_ORIGIN, 'https://api.vidzy.org/');
  private catalogApiUrl?: string;

  constructor(options: { catalogApiUrl?: string } = {}) {
    this.catalogApiUrl = options.catalogApiUrl?.replace(/\/+$/, '');
  }

  private async getAvailability(tmdbId: string): Promise<VidzyAvailability> {
    const { data } = await this.vidzyHttp.get(`/api/${tmdbId}`);
    const availability = typeof data === 'string' ? JSON.parse(data) : data;

    if (
      !availability ||
      availability.available !== true ||
      !['movie', 'tv'].includes(availability.detectedType)
    ) {
      throw new Error('Ce média est indisponible sur Vidzy');
    }

    return availability as VidzyAvailability;
  }

  async search(query: string): Promise<SearchResult[]> {
    const normalizedQuery = query.trim();
    if (/^\d+$/.test(normalizedQuery)) {
      // A numeric TMDB id can identify both a film and a series. Inspect both
      // typed routes; the untyped API can even attach the series title to a film.
      const results = await Promise.allSettled((['movie', 'series'] as const).map(async type => {
        const path = type === 'movie' ? `/movie/${normalizedQuery}` : `/serie/${normalizedQuery}/1/1`;
        const { data } = await this.vidzyHttp.get(path, { headers: WRAPPER_HEADERS });
        const html = String(data);
        const valid = type === 'movie' ? readPlayerConfig(html)?.type === 'movie'
          : extractVidzySeriesSeason(html, normalizedQuery, 1);
        if (!valid || !extractVidzyIframeUrl(html)) return [];
        const title = cheerio.load(html)('title').text().trim();
        if (!title) return [];
        return [{ id: encodeMediaId(normalizedQuery), title: type === 'series'
          ? title.replace(/\s*-\s*Saison\s+\d+\b.*$/i, '').trim() : title,
          type, providerId: 'vidzy' as const }];
      }));
      return results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
    }
    if (!this.catalogApiUrl) {
      throw new Error('Le catalogue TMDB Horus n’est pas configuré');
    }

    const url = new URL('/v1/search', this.catalogApiUrl);
    url.searchParams.set('query', normalizedQuery);
    const { data } = await HttpClient.create().get<HorusCatalogResponse>(url.toString());
    return (data.results || []).map(result => ({
      ...result,
      id: encodeMediaId(String(result.id)),
      providerId: 'vidzy',
    }));
  }

  private async readSeriesSeasons(tmdbId: string): Promise<VidzySeason[]> {
    const seasons: VidzySeason[] = [];
    // The series wrappers expose each season's actual episode list. They return
    // 404 after the last season; network errors must not look like an end marker.
    for (let season = 1; season <= MAX_FALLBACK_SEASONS; season++) {
      let html: string;
      try {
        const { data } = await this.vidzyHttp.get(`/serie/${tmdbId}/${season}/1`, {
          headers: WRAPPER_HEADERS,
        });
        html = String(data);
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 404) return seasons;
        throw error;
      }
      const entry = extractVidzySeriesSeason(html, tmdbId, season);
      if (!entry) throw new Error('Liste des épisodes de la série Vidzy introuvable');
      seasons.push(entry);
    }
    throw new Error('La liste des saisons Vidzy dépasse la limite de récupération');
  }

  async getEpisodes(mediaId: string, media?: Pick<SearchResult, 'type'>): Promise<Episode[]> {
    const tmdbId = parseMediaId(mediaId);
    if (media?.type === 'anime') throw new Error('Type de média Vidzy invalide');
    // Keep legacy ids stable for favourites/history. The catalogue type travels
    // alongside the id instead of being guessed again by Vidzy's untyped API.
    if (media?.type === 'movie') {
      return [{ id: `vidzy::movie::${tmdbId}`, number: 1, title: 'Film' }];
    }
    const availability = await this.getAvailability(tmdbId).catch(error => {
      if (media?.type === 'series') return undefined;
      throw error;
    });

    if (!media && availability?.detectedType === 'movie') {
      return [{ id: `vidzy::movie::${tmdbId}`, number: 1, title: 'Film' }];
    }

    const seasons = availability?.detectedType === 'tv' && availability.seasons?.length
      ? availability.seasons : await this.readSeriesSeasons(tmdbId);
    return seasons.flatMap(item =>
      item.episodes.map(episode => ({
        id: `vidzy::tv::${tmdbId}::${item.season}::${episode}`,
        number: episode,
        title: `Saison ${item.season} - Épisode ${episode}`,
      }))
    );
  }

  private async resolveDirectStream(
    tmdbId: string,
    language: string,
    season?: string,
    episode?: string
  ): Promise<Stream> {
    const path = season && episode
      ? `/serie/${tmdbId}/${season}/${episode}/${language}`
      : `/movie/${tmdbId}/${language}`;
    const wrapperUrl = `${VIDZY_ORIGIN}${path}`;
    const requestHeaders = WRAPPER_HEADERS;
    const { data: wrapperHtml } = await this.vidzyHttp.get(path, {
      headers: requestHeaders,
    });
    const html = String(wrapperHtml);
    if (season && episode) {
      const config = extractVidzySeriesSeason(html, tmdbId, Number(season));
      if (!config?.episodes.includes(Number(episode))) throw new Error('Épisode Vidzy indisponible');
    } else if (readPlayerConfig(html)?.type !== 'movie') {
      throw new Error('Lecteur film Vidzy introuvable');
    }
    const iframeUrl = extractVidzyIframeUrl(html);
    if (!iframeUrl) throw new Error('Lecteur Vidzy introuvable');

    const { data: embedHtml } = await HttpClient.create().get(iframeUrl, {
      headers: {
        ...requestHeaders,
        Referer: wrapperUrl,
      },
    });
    const embedHostname = new URL(iframeUrl).hostname.toLowerCase();
    const hlsUrl = extractVidzyHlsSource(String(embedHtml), embedHostname);
    if (!hlsUrl) throw new Error('Flux HLS Vidzy introuvable');

    return {
      url: hlsUrl,
      language: language.toUpperCase(),
      quality: 'auto',
      server: 'Vidzy',
      format: 'hls',
      contentType: 'application/vnd.apple.mpegurl',
      headers: {
        Referer: iframeUrl,
        Origin: VIDZY_EMBED_ORIGIN,
        Accept: '*/*',
        'User-Agent': BROWSER_USER_AGENT,
        // Vidzy rejects hotlinked HLS requests that omit Chromium's platform
        // client hint, even when the URL signature and Referer are valid.
        'Sec-CH-UA-Platform': '"Windows"',
      },
    };
  }

  async getStreams(episodeId: string, _episode?: Episode, media?: Pick<SearchResult, 'type'>): Promise<Stream[]> {
    const movieMatch = episodeId.match(/^vidzy::movie::(\d+)$/);
    const tvMatch = episodeId.match(/^vidzy::tv::(\d+)::(\d+)::(\d+)$/);
    if (!movieMatch && !tvMatch) throw new Error('Épisode Vidzy invalide');
    if (media && !isVidzyEpisodeForMedia(episodeId, media)) {
      throw new Error('Cet ancien épisode ne correspond pas au type du média. Sélectionnez un épisode dans sa fiche.');
    }

    const tmdbId = (movieMatch || tvMatch)?.[1] as string;
    // Probe the languages on the requested typed route, not on a colliding film
    // or series returned by /api/id. Only successfully extracted sources survive.
    const languages = ['vf', 'vostfr'];
    const resolved = await Promise.allSettled(
      languages.map(language => this.resolveDirectStream(
        tmdbId,
        language,
        tvMatch?.[2],
        tvMatch?.[3]
      ))
    );
    const streams = resolved.flatMap(result =>
      result.status === 'fulfilled' ? [result.value] : []
    );
    if (streams.length === 0) {
      throw new Error('Aucun flux direct Vidzy n’a pu être extrait');
    }
    return streams;
  }
}
