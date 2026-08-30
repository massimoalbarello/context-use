import { getPublicAssets } from '#lib/assets.ts';

type FrontendAssetsMap = Map<string, Blob>;

export class FrontendAssetsRepository {
  private assets: FrontendAssetsMap | null = null;

  list(): FrontendAssetsMap {
    if (this.assets) {
      return this.assets;
    }
    return this.loadAssets();
  }

  private loadAssets(): FrontendAssetsMap {
    const assets: FrontendAssetsMap = new Map();
    for (const [path, file] of getPublicAssets()) {
      assets.set(`/${path}`, file);
    }

    this.assets = assets;
    return assets;
  }
}
