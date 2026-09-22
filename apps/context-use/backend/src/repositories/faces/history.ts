import type { Database } from 'bun:sqlite';
import type { FacesRepositoryContract } from './contract.ts';
import { withTypes } from './sqlite.ts';

type AnnotationInput = Parameters<FacesRepositoryContract['annotate']>[0];

function annotationDescription({
  input,
  person,
}: {
  input: AnnotationInput;
  person: string | undefined;
}) {
  if (person) {
    return `Confirmed ${person} in this image`;
  }
  switch (input.annotation?.decision) {
    case 'dismissed':
      return 'Dismissed a detected face';
    case 'unknown':
      return 'Marked a face as unknown';
    default:
      return 'Restored automatic face identification';
  }
}

export function recordFaceAnnotationChange({
  database,
  input,
  face,
}: {
  database: Database;
  input: AnnotationInput;
  face: { decision: string | null; entityId: string | null; name: string; readableId: string };
}) {
  if (
    face.decision === (input.annotation?.decision ?? null) &&
    face.entityId === (input.annotation?.entityId ?? null)
  ) {
    return;
  }
  const db = withTypes(database);
  const people = db.FaceChangePerson`
    select "name" from "entity" where "owner_id" = ${input.ownerId} and "id" = ${input.annotation?.entityId ?? null}
  `;
  const detail = annotationDescription({ input, person: people[0]?.name });
  db.InsertFaceResourceChange`
    insert into "resource_change" ("owner_id", "resource_type", "readable_id", "name", "action", "message", "client_name", "details", "created_at")
    values (${input.ownerId}, 'asset', ${face.readableId}, ${face.name}, 'updated', ${input.change.message.trim()}, ${input.change.clientName}, ${JSON.stringify([detail])}, ${input.updatedAt})
  `;
}
