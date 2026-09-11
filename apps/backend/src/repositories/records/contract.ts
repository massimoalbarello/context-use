import type { DeliveredRecord } from '#models/records/delivery-contract.generated.ts';
import type {
  RecordAcceptanceResult,
  RecordListFilters,
  RecordPage,
  RecordResource,
} from '#models/records/model.ts';

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

export type ListRecordsInput = RecordListFilters & {
  ownerId: string;
  limit: number;
  offset: number;
};

export interface RecordsRepositoryContract {
  accept(input: AcceptRecordsInput): Promise<RecordAcceptanceResult>;
  listResources(input: ListRecordsInput): Promise<RecordPage>;
  findResource(input: { ownerId: string; readableId: string }): Promise<RecordResource | null>;
}
