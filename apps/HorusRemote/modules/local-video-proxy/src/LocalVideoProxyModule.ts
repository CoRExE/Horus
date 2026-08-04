import { NativeModule, requireNativeModule } from 'expo';
import {
  CachedMediaInfo,
  LocalVideoProxyEvents,
  LocalVideoProxyServerInfo,
} from './LocalVideoProxy.types';

declare class LocalVideoProxyModule extends NativeModule<LocalVideoProxyEvents> {
  startServer(port: number): Promise<LocalVideoProxyServerInfo>;
  stopServer(): Promise<void>;
  cacheMedia(
    url: string,
    format: 'hls' | 'file',
    referer?: string,
    origin?: string,
    userAgent?: string
  ): Promise<CachedMediaInfo>;
  cancelCache(): Promise<void>;
  removeCachedMedia(id: string): Promise<void>;
  clearCache(): Promise<void>;
  acquireMulticastLock(): Promise<void>;
  releaseMulticastLock(): Promise<void>;
}

export default requireNativeModule<LocalVideoProxyModule>('LocalVideoProxy');
