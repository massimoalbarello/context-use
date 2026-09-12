-- Depicts is derived once from effective face assignments; people and faces keep their own identities.
create view "asset_depicts_entity" as
select distinct face."owner_id", face."asset_id", entity."id" as "entity_id", face."id" as "face_id",
  case when annotation."face_id" is null then 'detected' else 'confirmed' end as "source"
from "asset_face" face
join "asset" asset on asset."id" = face."asset_id" and asset."owner_id" = face."owner_id" and asset."archived_at" is null
left join "face_annotation" annotation on annotation."face_id" = face."id" and annotation."owner_id" = face."owner_id"
left join "face_match" match on match."face_id" = face."id" and match."owner_id" = face."owner_id"
left join "entity_face_reference" reference on reference."entity_id" = match."entity_id" and reference."owner_id" = match."owner_id" and reference."face_id" = match."reference_face_id"
left join "asset_face" reference_face on reference_face."id" = reference."face_id" and reference_face."owner_id" = reference."owner_id"
left join "face_embedding" reference_embedding on reference_embedding."face_id" = reference_face."id" and reference_embedding."owner_id" = reference_face."owner_id"
join "entity" entity on entity."owner_id" = face."owner_id" and entity."id" = coalesce(annotation."entity_id", match."entity_id") and entity."archived_at" is null and entity."entity_type" = 'person'
where annotation."decision" = 'person' or (
  annotation."face_id" is null and face."current" = 1 and face."needs_review" = 0
  and reference_face."asset_id" = entity."image_asset_id"
  and reference_embedding."embedding_space" = match."embedding_space"
);
