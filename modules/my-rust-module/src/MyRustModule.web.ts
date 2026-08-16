import { registerWebModule, NativeModule } from 'expo';

// MyRustModule is not available on the web platform.
class MyRustModule extends NativeModule<{}> {
  hello(): string {
    return 'MyRustModule is not available on web';
  }
}

export default registerWebModule(MyRustModule, 'MyRustModule');
