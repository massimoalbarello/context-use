export interface PublicationStatus {
  publicId: string | null;
  publishedAt: string | null;
}

export interface PagePublicationStatus extends PublicationStatus {
  revisionId: string | null;
}

export interface PublicationResource {
  resourceType: 'page' | 'entity' | 'asset';
  readableId: string;
  name: string;
}

export interface PublicationBlocker {
  reason: 'public_page_reference' | 'public_entity_image' | 'image_unavailable';
  resource: PublicationResource;
}

export interface PublicationPreparation {
  resource: PublicationResource;
  publication: PublicationStatus;
  includedImage: { resource: PublicationResource; publication: PublicationStatus } | null;
  blockers: PublicationBlocker[];
  expectedState: string;
}
