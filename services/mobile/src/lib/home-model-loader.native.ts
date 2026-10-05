import { Asset } from 'expo-asset';
import { File, FileMode, Paths } from 'expo-file-system';
import { copyAsync } from 'expo-file-system/legacy';
import { createNativeHomeLoader } from './native-home-model-loader';

export const HomeModelLoader = createNativeHomeLoader(async url => {
  const asset = await Asset.fromURI(url).downloadAsync();
  let uri = asset.localUri ?? asset.uri;
  // Android release assets can use a packaged resource path. Copy on disk;
  // unlike Fiber's model loader, never read the resource as a base64 string.
  if (!uri.includes(':')) {
    const local = new File(Paths.cache, `kea-home-${asset.hash ?? 'bundled'}.glb`);
    await copyAsync({ from: uri, to: local.uri }); uri = local.uri;
  }
  const file = new File(uri);
  return { size: file.size, open: () => file.open(FileMode.ReadOnly) };
});
