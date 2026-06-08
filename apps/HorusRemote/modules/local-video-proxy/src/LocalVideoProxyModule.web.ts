import { registerWebModule, NativeModule } from 'expo';

class LocalVideoProxyModule extends NativeModule<{}> {}

export default registerWebModule(LocalVideoProxyModule, 'LocalVideoProxyModule');
