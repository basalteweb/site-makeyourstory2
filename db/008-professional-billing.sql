set search_path to makeyourstory, public;

create table if not exists professional_plans (
  id text primary key check(id in ('single','monthly')),
  amount integer not null check(amount between 100 and 5000000),
  quantity integer not null check(quantity between 1 and 1000),
  active boolean not null default false,
  stripe_product_id text,
  stripe_price_id text,
  revision uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default now()
);
-- Proposed launch prices, unavailable for purchase until explicitly enabled by the owner.
insert into professional_plans (id,amount,quantity) values ('single',1990,1),('monthly',2990,5) on conflict do nothing;
alter table professional_accounts add column if not exists stripe_customer_id text unique;

create table if not exists professional_checkouts (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references professional_accounts,
  plan_id text not null references professional_plans,
  stripe_price_id text not null,
  amount integer not null check(amount>0),
  quantity integer not null check(quantity>0),
  request_key uuid not null,
  terms_version text not null,
  status text not null default 'pending' check(status in ('pending','paid','expired','failed')),
  stripe_session_id text unique,
  stripe_subscription_id text unique,
  risk_hold boolean not null default false,
  created_at timestamptz not null default now(),
  unique(professional_id,request_key)
);
create index if not exists professional_checkouts_owner on professional_checkouts(professional_id,created_at desc);

create table if not exists professional_subscriptions (
  id text primary key,
  professional_id uuid not null references professional_accounts,
  checkout_id uuid not null unique references professional_checkouts,
  stripe_price_id text not null,
  amount integer not null,
  quantity integer not null,
  status text not null,
  period_start timestamptz,
  period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  risk_hold boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists professional_subscriptions_owner on professional_subscriptions(professional_id);

-- Each paid item buys a creation, or a fixed monthly bundle; never metered billing.
-- Existing projects remain usable when an allowance expires or a subscription ends.
create table if not exists professional_allowances (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references professional_accounts,
  kind text not null check(kind in ('single','monthly','gift')),
  checkout_id uuid unique references professional_checkouts,
  subscription_id text references professional_subscriptions,
  stripe_invoice_id text unique,
  stripe_pi_id text unique,
  quantity integer not null check(quantity between 1 and 1000),
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  captured_amount integer not null default 0 check(captured_amount>=0),
  refunded_amount integer not null default 0 check(refunded_amount between 0 and captured_amount),
  invoice_url text,
  receipt_url text,
  revoked_at timestamptz,
  note text not null default '',
  granted_by uuid references customers,
  created_at timestamptz not null default now()
);
create index if not exists professional_allowances_owner on professional_allowances(professional_id,valid_until);
alter table professional_projects add column if not exists allowance_id uuid references professional_allowances;
create index if not exists professional_projects_allowance on professional_projects(allowance_id);
create table if not exists professional_billing_events (
  id text primary key,
  professional_id uuid not null references professional_accounts,
  kind text not null,
  actor_id uuid references customers,
  note text not null default '',
  received_at timestamptz not null default now()
);
