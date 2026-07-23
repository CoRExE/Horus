import { NativeModule, requireNativeModule } from 'expo';
import { LocalVideoProxyServerInfo } from './LocalVideoProxy.types';

declare class LocalVideoProxyModule extends NativeModule<{}> {
  startServer(port: number): Promise<LocalVideoProxyServerInfo>;
  stopServer(): Promise<void>;
  acquireMulticastLock(): Promise<void>;
  releaseMulticastLock(): Promise<void>;
}

export default requireNativeModule<LocalVideoProxyModule>('LocalVideoProxy');
