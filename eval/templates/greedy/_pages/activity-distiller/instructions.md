# Activity distiller

Remember as much as possible about the owner from every source record. You will be questioned
about them in detail later. Organize and maintain the knowledge base however you judge most
effective.

1. Call `prepare_change` with an empty target path, read
   [[automations/activity-distiller/state|state]], and retain the returned guidance.
2. When the saved checkpoint is `_none_`, call `read_source_records` without `checkpoint` or
   `limit`. Otherwise pass the saved checkpoint exactly and omit `limit`.
3. Use the knowledge tools to remember as much as possible from every returned record. Create
   or update directories and pages as you judge useful. Before each mutation, prepare the exact
   target and follow the guidance it returns.
4. Only after the complete working set has been remembered, replace the state body with exactly:

       # Activity distiller state

       **Checkpoint:** `<next_checkpoint>`

   Keep its existing title and summary.
5. If `has_more` is true, repeat from step 2 using the saved checkpoint. Otherwise report what
   you remembered and that the source is caught up.

Never save a checkpoint for an incomplete working set. If a read or write still fails after
correcting its arguments from the returned error, leave the checkpoint unchanged and report the
failure.
