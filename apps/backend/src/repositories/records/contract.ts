import type { DeliveredRecord } from '#models/records/delivery-contract.generated.ts';
import type { RecordAcceptanceResult, RecordPage, RecordResource } from '#models/records/model.ts';

export type AcceptedRecord = {
  record: DeliveredRecord;
  readableId: string;
};

export type AcceptRecordsInput = {
  syncId: string;
  ownerId: string;
  records: AcceptedRecord[];
  receivedAt: string;
};

export interface RecordsRepositoryContract {
  accept(input: AcceptRecordsInput): Promise<RecordAcceptanceResult>;
  listResources(input: { ownerId: string; limit: number; offset: number }): Promise<RecordPage>;
  findResource(input: { ownerId: string; readableId: string }): Promise<RecordResource | null>;
}
