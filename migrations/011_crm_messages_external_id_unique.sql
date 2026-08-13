-- migrations/011_crm_messages_external_id_unique.sql
--
-- Defense-in-depth for webhook redelivery / echo loops (see
-- modules/threads/service.js's handleReplyEvent and shared/crmMessages.js's
-- messageExists). The application now checks for an existing message by
-- external_id before recording a new one, but that check-then-insert isn't
-- atomic — two webhook deliveries for the same event landing at nearly the
-- same time could both pass the check before either has inserted. This
-- unique index makes the second insert fail instead of creating a
-- duplicate row, closing that race.
--
-- Partial (where external_id is not null) because plenty of rows never get
-- one (e.g. failed sends), and those shouldn't collide with each other.
create unique index if not exists uq_crm_messages_client_channel_external_id
  on crm_messages (client_id, channel, external_id)
  where external_id is not null;
