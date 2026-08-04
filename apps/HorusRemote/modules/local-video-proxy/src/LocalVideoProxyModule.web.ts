import { registerWebModule, NativeModule } from 'expo';
import {
  CachedMediaInfo,
  LocalVideoProxyEvents,
  LocalVideoProxyServerInfo,
} from './LocalVideoProxy.types';

class LocalVideoProxyModule extends NativeModule<LocalVideoProxyEvents> {
  async startServer(_port: number): Promise<LocalVideoProxyServerInfo> {
    return { ip: '127.0.0.1', token: '' };
  }

  async stopServer(): Promise<void> {}

  async cacheMedia(): Promise<CachedMediaInfo> {
    throw new Error('Le cache média TV nécessite l’application native.');
  }

  async cancelCache(): Promise<void> {}

  async removeCachedMedia(_id: string): Promise<void> {}

  async clearCache(): Promise<void> {}

  async acquireMulticastLock(): Promise<void> {}

  async releaseMulticastLock(): Promise<void> {}
}

export default registerWebModule(LocalVideoProxyModule, 'LocalVideoProxyModule');
