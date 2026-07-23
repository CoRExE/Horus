export type ProviderId = 'anime-sama' | 'all-anime' | 'french-stream';

export interface SearchResult {
  id: string; // URL path or unique identifier (e.g. "/catalogue/naruto")
  title: string;
  coverUrl?: string; // Standardized thumbnail URL
  type: 'movie' | 'series' | 'anime';
  providerId: ProviderId;
}

export interface Episode {
  id: string; // URL or identifier for specific episode
  number: string | number;
  title?: string;
}

export interface Stream {
  url: string; // Direct stream URL (.m3u8, .mp4, etc.)
  language: string; // "VF", "VOSTFR", etc.
  quality?: string; // "1080p", "720p", "auto"
  server: string; // "Sibnet", "Sendvid", "Voe", etc.
  headers?: Record<string, string>; // HTTP headers needed for playback (e.g. Referer)
}

export interface HorusProvider {
  name: string;
  search(query: string): Promise<SearchResult[]>;
  getEpisodes(mediaId: string): Promise<Episode[]>;
  getStreams(episodeId: string): Promise<Stream[]>;
}

export function groupStreamsByLanguage(streams: Stream[]): Record<string, Stream[]> {
  return streams.reduce((grouped, stream) => {
    const lang = stream.language || 'VF';
    
    if (!grouped[lang]) {
      grouped[lang] = [];
    }
    
    grouped[lang].push(stream);
    return grouped;
  }, {} as Record<string, Stream[]>);
}
