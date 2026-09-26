import type { EntityType } from '#backend/models/entities/model.ts';

export const PUBLICATION_VISIBILITIES = ['all', 'public', 'private'] as const;
export type PublicationVisibility = (typeof PUBLICATION_VISIBILITIES)[number];

export interface PublicationStatus {
  publicId: string | null;
  publishedAt: string | null;
}

export interface PagePublicationStatus extends PublicationStatus {
  publishedRevisionNumber: number | null;
}

export interface PublicationResource {
  resourceType: 'page' | 'entity' | 'asset' | 'record';
  readableId: string;
  name: string;
}

export interface PublicationBlocker {
  reason:
    | 'public_page_reference'
    | 'public_entity_image'
    | 'public_record_reference'
    | 'image_unavailable'
    | 'reference_not_public'
    | 'reference_unavailable';
  resource: PublicationResource;
}

export interface PublicationPreparation {
  resource: PublicationResource;
  publication: PublicationStatus;
  includedImage: { resource: PublicationResource; publication: PublicationStatus } | null;
  entityIdentity: { description: string; entityType: EntityType | null } | null;
  pageRevision: {
    publicHomepage: boolean;
    revisionNumber: number | null;
    publishedRevisionNumber: number | null;
  } | null;
  blockers: PublicationBlocker[];
  expectedState: string;
}
