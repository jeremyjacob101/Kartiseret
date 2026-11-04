begin;

alter table public.ticket_alert_subscriptions
  add column delivery_filter_mask integer not null default 0
  check (delivery_filter_mask >= 0 and delivery_filter_mask < 1048576);

comment on column public.ticket_alert_subscriptions.delivery_filter_mask is
  'Showtime filter exclusions captured when a ticket alert delivery is claimed, encoded using the public movie-route filter mask.';

commit;
