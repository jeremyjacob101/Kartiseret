begin;

alter table public.ticket_alert_subscriptions
  drop constraint ticket_alert_subscriptions_delivery_filter_mask_check,
  add constraint ticket_alert_subscriptions_delivery_filter_mask_check
    check (delivery_filter_mask >= 0 and delivery_filter_mask < 2097152);

commit;
