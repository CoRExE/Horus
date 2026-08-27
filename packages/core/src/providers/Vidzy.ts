import { Episode, HorusProvider, SearchResult, Stream } from '../types';
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

const encodeMediaId = (tmdbId: string) => `vidzy::${tmdbId}`;

const parseMediaId = (mediaId: string) => {
  const match = mediaId.match(/^vidzy::(\d+)$/);
  if (!match) throw new Error('Identifiant Vidzy invalide');
  return match[1];
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

  private toSearchResult(availability: VidzyAvailability): SearchResult {
    const title = [availability.title, availability.year ? `(${availability.year})` : '']
      .filter(Boolean)
      .join(' ');
    return {
      id: encodeMediaId(String(availability.tmdb_id)),
      title,
      coverUrl: availability.poster,
      type: availability.detectedType === 'tv' ? 'series' : 'movie',
      providerId: 'vidzy',
    };
  }

  async search(query: string): Promise<SearchResult[]> {
    const normalizedQuery = query.trim();
    if (/^\d+$/.test(normalizedQuery)) {
      try {
        return [this.toSearchResult(await this.getAvailability(normalizedQuery))];
      } catch {
        return [];
      }
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

  async getEpisodes(mediaId: string): Promise<Episode[]> {
    const tmdbId = parseMediaId(mediaId);
    const availability = await this.getAvailability(tmdbId);

    if (availability.detectedType === 'movie') {
      return [{ id: `vidzy::movie::${tmdbId}`, number: 1, title: 'Film' }];
    }

    return (availability.seasons || []).flatMap(item =>
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
    const requestHeaders = {
      'User-Agent': BROWSER_USER_AGENT,
      Referer: 'https://api.vidzy.org/',
    };
    const { data: wrapperHtml } = await this.vidzyHttp.get(path, {
      headers: requestHeaders,
    });
    const iframeUrl = extractVidzyIframeUrl(String(wrapperHtml));
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

  async getStreams(episodeId: string): Promise<Stream[]> {
    const movieMatch = episodeId.match(/^vidzy::movie::(\d+)$/);
    const tvMatch = episodeId.match(/^vidzy::tv::(\d+)::(\d+)::(\d+)$/);
    if (!movieMatch && !tvMatch) throw new Error('Épisode Vidzy invalide');

    const tmdbId = (movieMatch || tvMatch)?.[1] as string;
    const availability = await this.getAvailability(tmdbId);
    const languages = availability.languages?.length
      ? availability.languages
      : ['vf'];
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
