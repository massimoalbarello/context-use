export interface PublicationStatus {
  publicId: string | null;
  publishedAt: string | null;
}

export interface PagePublicationStatus extends PublicationStatus {
  revisionId: string | null;
}
