begin;

-- A saved ticket remains one booking (and therefore one reminder). Additional
-- admissions are private QR payloads attached to that booking. The original QR
-- stays in user_wallet_tickets.qr_message so its existing Wallet serial number
-- and older app clients remain valid.
create table public.user_wallet_ticket_qr_codes (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.user_wallet_tickets (id) on delete cascade,
  position smallint not null,
  qr_message text not null,
  created_at timestamptz not null default now(),
  constraint user_wallet_ticket_qr_codes_position_check check (position between 2 and 10),
  constraint user_wallet_ticket_qr_codes_qr_message_check check (
    length(qr_message) between 1 and 2048 and octet_length(qr_message) <= 2048
  ),
  constraint user_wallet_ticket_qr_codes_ticket_position_key unique (ticket_id, position),
  constraint user_wallet_ticket_qr_codes_ticket_message_key unique (ticket_id, qr_message)
);

create index user_wallet_ticket_qr_codes_ticket_idx
  on public.user_wallet_ticket_qr_codes (ticket_id, position);

comment on table public.user_wallet_ticket_qr_codes is
  'Additional private admission QR payloads for a user-owned cinema ticket booking. The first QR remains on user_wallet_tickets for stable Wallet serial compatibility.';

alter table public.user_wallet_ticket_qr_codes enable row level security;
revoke all on public.user_wallet_ticket_qr_codes from public, anon, authenticated, service_role;
grant select, delete on public.user_wallet_ticket_qr_codes to kartiseret_runtime;
-- Drizzle explicitly includes the generated columns with DEFAULT.
grant insert (id, ticket_id, position, qr_message, created_at)
  on public.user_wallet_ticket_qr_codes to kartiseret_runtime;

create policy api_own_select on public.user_wallet_ticket_qr_codes
  for select to kartiseret_runtime
  using (
    exists (
      select 1
      from public.user_wallet_tickets as ticket
      where ticket.id = user_wallet_ticket_qr_codes.ticket_id
        and ticket.user_id = (select app_auth.current_user_id())
    )
  );
create policy api_own_insert on public.user_wallet_ticket_qr_codes
  for insert to kartiseret_runtime
  with check (
    exists (
      select 1
      from public.user_wallet_tickets as ticket
      where ticket.id = user_wallet_ticket_qr_codes.ticket_id
        and ticket.user_id = (select app_auth.current_user_id())
    )
  );
create policy api_own_delete on public.user_wallet_ticket_qr_codes
  for delete to kartiseret_runtime
  using (
    exists (
      select 1
      from public.user_wallet_tickets as ticket
      where ticket.id = user_wallet_ticket_qr_codes.ticket_id
        and ticket.user_id = (select app_auth.current_user_id())
    )
  );

commit;
