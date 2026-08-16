import { NativeModule, requireNativeModule } from 'expo';

declare class MyRustModule extends NativeModule<{}> {
  hello(): string;
}

export default requireNativeModule<MyRustModule>('MyRustModule');
