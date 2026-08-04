// Define your exported module types here.
export type LocalVideoProxyServerInfo = {
  ip: string;
  token: string;
};

export type CachedMediaInfo = {
  id: string;
  contentType: string;
  sizeBytes: number;
};

export type CacheProgressEvent = {
  bytesDownloaded: number;
  totalBytes?: number;
};

export type LocalVideoProxyEvents = {
  onCacheProgress: (event: CacheProgressEvent) => void;
};
