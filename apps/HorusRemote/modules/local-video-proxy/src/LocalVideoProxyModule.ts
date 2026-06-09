import { NativeModule, requireNativeModule } from 'expo';

declare class LocalVideoProxyModule extends NativeModule<{}> {
  startServer(port: number): Promise<string>;
  stopServer(): Promise<void>;
  acquireMulticastLock(): Promise<void>;
  releaseMulticastLock(): Promise<void>;
}

export default requireNativeModule<LocalVideoProxyModule>('LocalVideoProxy');
