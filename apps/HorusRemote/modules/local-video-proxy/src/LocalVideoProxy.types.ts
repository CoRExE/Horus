// Define your exported module types here.
export type LocalVideoProxyServerInfo = {
  ip: string;
  port: number;
  token: string;
};

export type CachedMediaInfo = {
  id: string;
  contentType: string;
  sizeBytes: number;
  durationSeconds?: number;
  seekable: boolean;
  fallbackReason?: string;
  dlnaStarted?: boolean;
  dlnaStartError?: string;
};

export type CacheProgressEvent = {
  bytesDownloaded: number;
  totalBytes?: number;
  phase?: 'downloading' | 'optimizing';
  phaseProgress?: number;
  totalBytesEstimated?: boolean;
};

export type TvNotificationMode = 'direct' | 'preparing' | 'player';

export type MediaControlEvent = {
  action: 'play' | 'pause' | 'seek' | 'stop';
  positionSeconds?: number;
};

export type LocalVideoProxyEvents = {
  onCacheProgress: (event: CacheProgressEvent) => void;
  onMediaControl: (event: MediaControlEvent) => void;
};
