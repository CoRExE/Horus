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
  format?: 'hls' | 'file'; // Explicit hint when the URL does not expose its container
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

export function inferStreamFormat(
  stream: Pick<Stream, 'url' | 'format'>
): NonNullable<Stream['format']> {
  if (stream.format) return stream.format;

  const pathname = stream.url.split(/[?#]/, 1)[0].toLowerCase();
  return /\.(?:m3u8|m3u)$/.test(pathname) ? 'hls' : 'file';
}

export function formatRemoteMediaTitle(
  media: Pick<SearchResult, 'title' | 'type'>,
  episode: Episode
): string {
  if (media.type === 'movie') return media.title;

  const episodeLabel = `Ep ${episode.number}`;
  const seasonMatch = episode.title?.match(/(?:saison|season)\s+[\w.-]+/i);
  if (!seasonMatch) return `${media.title} - ${episodeLabel}`;

  const seasonLabel = seasonMatch[0].replace(/^season/i, 'Saison');
  if (media.title.toLowerCase().includes(seasonLabel.toLowerCase())) {
    return `${media.title} - ${episodeLabel}`;
  }

  return `${media.title} - ${seasonLabel} - ${episodeLabel}`;
}

export function parseDlnaTime(value?: string): number {
  if (!value || value === 'NOT_IMPLEMENTED') return 0;

  const parts = value.split(':');
  if (parts.length !== 3) return 0;

  const [hours, minutes, seconds] = parts.map(Number);
  if (![hours, minutes, seconds].every(Number.isFinite)) return 0;

  return Math.max(0, hours * 3600 + minutes * 60 + seconds);
}

export function formatDlnaTime(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  return [hours, minutes, seconds]
    .map(value => String(value).padStart(2, '0'))
    .join(':');
}

export function formatPlaybackTime(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
