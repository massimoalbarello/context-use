import type { PublicSiteRepositoryContract } from '#backend/repositories/public-site/repository.ts';

export class PublicSiteService {
  constructor(private readonly site: PublicSiteRepositoryContract) {}

  async settings(input: { ownerId: string }) {
    return { homepage: await this.site.homepage(input) };
  }

  setHomepage(input: { ownerId: string; readableId: string | null }) {
    return this.site.setHomepage(input);
  }
}

export type PublicSiteServiceContract = Pick<PublicSiteService, 'settings' | 'setHomepage'>;
