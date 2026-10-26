-- Ticket alerts are account-only. The frontend and backend use direct table
-- access, so remove the guest table and all ticket-alert RPCs.

drop function if exists public.create_guest_ticket_alert(uuid, bigint, text, text);
drop function if exists public.cancel_guest_ticket_alert(uuid, bigint);
drop function if exists public.claim_guest_ticket_alert_delivery(uuid, uuid, jsonb);
drop function if exists public.record_guest_ticket_alert_delivery_attempt(uuid, uuid);

drop table if exists public.ticket_alert_guest_subscriptions;

drop function if exists public.claim_ticket_alert_delivery(uuid, uuid, jsonb);
drop function if exists public.record_ticket_alert_delivery_attempt(uuid, uuid);
