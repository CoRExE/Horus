export interface SearchResult {
  id: string; // URL path or unique identifier (e.g. "/catalogue/naruto")
  title: string;
  coverUrl?: string; // Standardized thumbnail URL
  type: 'movie' | 'series' | 'anime';
}

export interface Episode {
  id: string; // URL or identifier for specific episode
  number: string | number;
  title?: string;
}

export interface Stream {
  url: string; // Direct stream URL (.m3u8, .mp4, etc.)
  quality: string; // "1080p", "720p", "auto"
  server: string; // "Sibnet", "Sendvid", "Voe", etc.
}

export interface HorusProvider {
  name: string;
  search(query: string): Promise<SearchResult[]>;
  getEpisodes(mediaId: string): Promise<Episode[]>;
  getStreams(episodeId: string): Promise<Stream[]>;
}
