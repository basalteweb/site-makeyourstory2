set search_path to makeyourstory, pg_catalog;
alter table events add column if not exists title text not null default '';
alter table events add column if not exists location text not null default '';
alter table events add column if not exists practical text not null default '';
alter table events add column if not exists questions jsonb not null default '[]';
alter table responses add column if not exists answers jsonb not null default '[]';
create table if not exists guest_messages (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references responses on delete cascade,
  from_organizer boolean not null,
  content text not null check (length(content) between 1 and 1200),
  request_key uuid not null unique,
  created_at timestamptz not null default now()
);
create index if not exists guest_messages_response on guest_messages(response_id,created_at);
