import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system";

import mathJaxAssetId from "@/assets/mathjax/tex-svg.txt";

const mathJaxAsset = Asset.fromModule(mathJaxAssetId);

let cached: Promise<string> | null = null;

/**
 * MathJax's `tex-svg` bundle, loaded once from a local asset instead of a
 * CDN — math renders instantly and works fully offline. The result is
 * cached so every `MathView`/`MathArticle` instance shares one load.
 */
export function getMathJaxSource(): Promise<string> {
  if (!cached) {
    cached = (async () => {
      await mathJaxAsset.downloadAsync();
      const uri = mathJaxAsset.localUri ?? mathJaxAsset.uri;
      const source = await FileSystem.readAsStringAsync(uri);
      // Guard against a literal "</script>" prematurely closing our inline tag.
      return source.replace(/<\/script/gi, "<\\/script");
    })();
  }
  return cached;
}
