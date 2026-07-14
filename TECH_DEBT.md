# Technical Debt

## Bound persisted LoRA preset share snapshots

**Priority:** P2

The `/lora_preset share` flow stores a new immutable snapshot and its LoRA items for every invocation. These records currently have no retention period or per-user limit. Repeated shares can therefore grow `lora_preset_shares` and `lora_preset_share_items` without bound. Snapshots can also become unreachable when a Discord message is removed by a moderator or fails to post after the database insert.

Proposed remediation:

- Expire shared snapshots after 30 days.
- Retain at most 25 snapshots per creator, pruning the oldest snapshots before inserting a new one.
- Remove expired snapshots during database startup and opportunistically when creating a share.
- Delete a newly saved snapshot if posting or editing its Discord reply fails.
- Add indexes on `created_at` and `(creator_id, created_at)` for cleanup queries, including backward-compatible SQLite migrations.
- State the 30-day availability period in the shared preset embed and user-facing documentation.

The foreign keys on `lora_preset_share_items` should continue using `ON DELETE CASCADE` so cleanup of a snapshot also removes all of its items.

Acceptance criteria:

- A creator cannot retain more than 25 shared snapshots.
- Snapshots older than 30 days are removed with their item rows.
- A failed Discord post does not leave a persisted snapshot behind.
- Existing PostgreSQL and SQLite installations migrate without requiring a fresh database.
