-- Ticket alert delivery now uses guarded service-role REST updates.
-- Remove the transitional RPCs from databases that applied the prior restore
-- migration, while remaining harmless for databases where they were already
-- removed.

drop function if exists public.claim_ticket_alert_delivery(uuid, uuid, jsonb);
drop function if exists public.record_ticket_alert_delivery_attempt(uuid, uuid);
