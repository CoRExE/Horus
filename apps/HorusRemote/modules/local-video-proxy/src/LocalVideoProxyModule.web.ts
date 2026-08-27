import { registerWebModule, NativeModule } from 'expo';
import {
  CachedMediaInfo,
  LocalVideoProxyEvents,
  LocalVideoProxyServerInfo,
} from './LocalVideoProxy.types';

class LocalVideoProxyModule extends NativeModule<LocalVideoProxyEvents> {
  async startServer(_port: number, _keepAlive: boolean): Promise<LocalVideoProxyServerInfo> {
    return { ip: '127.0.0.1', port: _port, token: '' };
  }

  async stopServer(): Promise<void> {}

  async setTvNotificationMode(): Promise<void> {}

  async updateTvPlaybackState(): Promise<void> {}

  async updateTvCacheProgress(): Promise<void> {}

  async cacheMedia(): Promise<CachedMediaInfo> {
    throw new Error('Le cache média TV nécessite l’application native.');
  }

  async cancelCache(): Promise<void> {}

  async removeCachedMedia(_id: string): Promise<void> {}

  async persistCachedMedia(_id: string): Promise<void> {}

  async getOfflineMediaUri(_id: string): Promise<string> {
    throw new Error('La lecture hors ligne nécessite l’application native Android.');
  }

  async removeOfflineMedia(_id: string): Promise<void> {}

  async listOfflineMediaIds(): Promise<string[]> { return []; }

  async clearCache(): Promise<void> {}

  async acquireMulticastLock(): Promise<void> {}

  async releaseMulticastLock(): Promise<void> {}

  async exitApp(): Promise<void> {}
}

export default registerWebModule(LocalVideoProxyModule, 'LocalVideoProxyModule');
