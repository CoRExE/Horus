import { NativeModule, requireNativeModule } from 'expo';
import {
  CachedMediaInfo,
  LocalVideoProxyEvents,
  LocalVideoProxyServerInfo,
  TvNotificationMode,
} from './LocalVideoProxy.types';

declare class LocalVideoProxyModule extends NativeModule<LocalVideoProxyEvents> {
  startServer(port: number): Promise<LocalVideoProxyServerInfo>;
  stopServer(): Promise<void>;
  getLastError(): Promise<string | null>;
  setTvNotificationMode(
    mode: TvNotificationMode,
    title?: string,
    imageUrl?: string,
    canSeek?: boolean
  ): Promise<void>;
  updateTvPlaybackState(
    isPlaying: boolean,
    positionSeconds: number,
    durationSeconds: number
  ): Promise<void>;
  updateTvCacheProgress(progress: number, phase: 'downloading' | 'optimizing'): Promise<void>;
  cacheMedia(
    url: string,
    format: 'hls' | 'file',
    referer?: string,
    origin?: string,
    userAgent?: string,
    maxHeight?: number,
    dlnaOptions?: {
      controlUrl: string;
      title?: string;
      imageUrl?: string;
    }
  ): Promise<CachedMediaInfo>;
  cancelCache(): Promise<void>;
  removeCachedMedia(id: string): Promise<void>;
  persistCachedMedia(id: string): Promise<void>;
  getOfflineMediaUri(id: string): Promise<string>;
  removeOfflineMedia(id: string): Promise<void>;
  listOfflineMediaIds(): Promise<string[]>;
  clearCache(): Promise<void>;
  acquireMulticastLock(): Promise<void>;
  releaseMulticastLock(): Promise<void>;
  exitApp(): Promise<void>;
}

export default requireNativeModule<LocalVideoProxyModule>('LocalVideoProxy');
