set search_path to makeyourstory, public;

create table if not exists professional_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references customers,
  company_name text not null,
  contact_name text not null,
  phone text not null default '',
  business_id text not null default '',
  activity text not null default '',
  status text not null default 'pending' check(status in ('pending','active','suspended')),
  access_until timestamptz,
  approved_by uuid references customers,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table orders drop constraint if exists orders_source_check;
alter table orders add constraint orders_source_check check(source in ('checkout','admin','legacy','professional'));
alter table orders drop constraint if exists orders_payment_status_check;
alter table orders add constraint orders_payment_status_check check(payment_status in ('pending','failed','abandoned','paid','partial_refund','refunded','included'));
alter table login_tokens add column if not exists destination text not null default 'client' check(destination in ('client','pro'));

create table if not exists professional_projects (
  order_id uuid primary key references orders,
  professional_id uuid not null references professional_accounts,
  mode text not null default 'autonomous' check(mode in ('autonomous','delegated')),
  delegation_status text not null default 'none' check(delegation_status in ('none','requested','accepted','declined')),
  delegation_note text not null default '',
  delegation_reply text not null default '',
  delegated_at timestamptz,
  client_invited_at timestamptz,
  request_key uuid not null,
  created_at timestamptz not null default now(),
  unique(professional_id,request_key)
);
create index if not exists professional_projects_account on professional_projects(professional_id,created_at desc);
create index if not exists professional_projects_requests on professional_projects(delegated_at) where delegation_status='requested';
