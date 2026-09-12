/** Generated from the pinned OpenConnector OpenAPI contract. Do not edit. */
/* biome-ignore-all lint: Generated code mirrors the external contract. */
export const RECORD_DELIVERY_VERSION = 1 as const;
export const MAX_RECORD_DELIVERY_BATCH_RECORDS = 50;
export const MAX_RECORD_DELIVERY_BYTES = 16777216;
export const MAX_RECORD_CONTENT_BYTES = 8388608;
export const MAX_RECORD_ATTRIBUTES_BYTES = 16384;

/**
 * A durable batch delivered by OpenConnector to one configured destination.
 */
export interface RecordDeliveryEnvelope {
  version: 1;
  /**
   * Stable batch identity. Retries preserve this value and the exact request body.
   */
  batchId: string;
  /**
   * @minItems 1
   * @maxItems 50
   */
  records: (
    | {
        /**
         * Stable event identity used to deduplicate retries.
         */
        eventId: string;
        provider: string;
        sourceId: string;
        kind: string;
        id: string;
        revision: number;
        operation: 'added';
        /**
         * SHA-256 of the canonical JSON record content, or the last content for a deletion.
         */
        contentHash: string;
        content: {
          /**
           * Descriptive plain-text title chosen by the sync for display and search.
           */
          title: string;
          /**
           * Markdown body of the record.
           */
          body: string;
          sourceUrl?: string;
          sourceCreatedAt?: string;
          sourceUpdatedAt?: string;
          /**
           * @maxItems 1000
           */
          participants?: {
            /**
             * @minItems 1
             * @maxItems 16
             */
            identities: {
              namespace: string;
              id: string;
            }[];
            /**
             * @minItems 1
             * @maxItems 32
             */
            roles: string[];
            name?: string;
          }[];
          /**
           * Provider-defined JSON object, limited to 16 KiB when canonically serialized.
           */
          attributes?: {
            [k: string]: unknown;
          };
          /**
           * Complete set of destination asset identifiers referenced by this record. Assets are uploaded independently before record delivery. Omission means no asset references.
           *
           * @maxItems 1000
           */
          assetIds?: string[];
        };
        committedAt: string;
      }
    | {
        /**
         * Stable event identity used to deduplicate retries.
         */
        eventId: string;
        provider: string;
        sourceId: string;
        kind: string;
        id: string;
        revision: number;
        operation: 'updated';
        /**
         * SHA-256 of the canonical JSON record content, or the last content for a deletion.
         */
        contentHash: string;
        content: {
          /**
           * Descriptive plain-text title chosen by the sync for display and search.
           */
          title: string;
          /**
           * Markdown body of the record.
           */
          body: string;
          sourceUrl?: string;
          sourceCreatedAt?: string;
          sourceUpdatedAt?: string;
          /**
           * @maxItems 1000
           */
          participants?: {
            /**
             * @minItems 1
             * @maxItems 16
             */
            identities: {
              namespace: string;
              id: string;
            }[];
            /**
             * @minItems 1
             * @maxItems 32
             */
            roles: string[];
            name?: string;
          }[];
          /**
           * Provider-defined JSON object, limited to 16 KiB when canonically serialized.
           */
          attributes?: {
            [k: string]: unknown;
          };
          /**
           * Complete set of destination asset identifiers referenced by this record. Assets are uploaded independently before record delivery. Omission means no asset references.
           *
           * @maxItems 1000
           */
          assetIds?: string[];
        };
        committedAt: string;
      }
    | {
        /**
         * Stable event identity used to deduplicate retries.
         */
        eventId: string;
        provider: string;
        sourceId: string;
        kind: string;
        id: string;
        revision: number;
        operation: 'deleted';
        /**
         * SHA-256 of the canonical JSON record content, or the last content for a deletion.
         */
        contentHash: string;
        committedAt: string;
      }
  )[];
}

export type DeliveredRecord = RecordDeliveryEnvelope['records'][number];
export type RecordContent = Extract<DeliveredRecord, { operation: 'added' | 'updated' }>['content'];
