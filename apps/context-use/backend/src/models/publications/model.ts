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
  resourceType: 'page' | 'entity' | 'asset';
  readableId: string;
  name: string;
}

export interface PublicationBlocker {
  reason:
    | 'public_page_reference'
    | 'public_entity_image'
    | 'image_unavailable'
    | 'reference_not_public'
    | 'reference_unavailable'
    | 'record_reference';
  resource: PublicationResource | { resourceType: 'record'; readableId: string; name: string };
}

export interface PublicationPreparation {
  resource: PublicationResource;
  publication: PublicationStatus;
  includedImage: { resource: PublicationResource; publication: PublicationStatus } | null;
  pageRevision: { revisionNumber: number | null; publishedRevisionNumber: number | null } | null;
  blockers: PublicationBlocker[];
  expectedState: string;
}
