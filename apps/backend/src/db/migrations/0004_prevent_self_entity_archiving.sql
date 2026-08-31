create trigger "entity_self_cannot_be_archived"
before update of "archived_at" on "entity"
when new."archived_at" is not null and exists (
  select 1
  from "knowledge_profile"
  where "owner_id" = new."owner_id" and "self_entity_id" = new."id"
)
begin
  select raise(abort, 'self entity cannot be archived');
end;
