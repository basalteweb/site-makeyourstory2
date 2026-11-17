create schema if not exists makeyourstory;
revoke all on schema makeyourstory from public;
set search_path to makeyourstory, public;

create table products (
  id text primary key,
  name text not null,
  amount integer not null check (amount > 0),
  category text not null,
  active boolean not null default true
);
insert into products (id, name, amount, category) values
  ('mariage', 'Invitation de mariage', 2990, 'mariage'),
  ('anniversaire', 'Invitation anniversaire', 2990, 'anniversaire'),
  ('naissance', 'Faire-part de naissance', 2990, 'naissance'),
  ('hommage', 'Annonce de décès et hommage', 2990, 'hommage'),
  ('album-mini', 'Album Émotion Mini', 4990, 'album'),
  ('album-complet', 'Album Émotion Complet', 6990, 'album');

create table customers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create table administrators (
  customer_id uuid primary key references customers on delete cascade,
  created_at timestamptz not null default now()
);
create table login_tokens (
  digest text primary key,
  customer_id uuid not null references customers on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create table sessions (
  digest text primary key,
  customer_id uuid not null references customers on delete cascade,
  expires_at timestamptz not null
);
create index sessions_customer on sessions(customer_id);
create table rate_limits (
  bucket text primary key,
  hits integer not null,
  expires_at timestamptz not null
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity (start with 1001) unique,
  customer_id uuid not null references customers,
  product_id text not null references products,
  product_name text not null,
  category text not null,
  amount integer not null check (amount > 0),
  currency text not null default 'eur' check (currency = 'eur'),
  client_name text not null,
  buyer_email text not null,
  billing_address text,
  initial_brief text not null default '',
  source text not null check (source in ('checkout', 'admin', 'legacy')),
  terms_version text,
  terms_accepted_at timestamptz,
  delivery_days integer check (delivery_days between 1 and 90),
  publication_months integer check (publication_months between 1 and 60),
  checkout_key uuid unique,
  stripe_session_id text unique,
  stripe_pi_id text unique,
  payment_status text not null default 'pending' check (payment_status in ('pending', 'failed', 'abandoned', 'paid', 'partial_refund', 'refunded')),
  paid_at timestamptz,
  captured_amount integer not null default 0 check (captured_amount >= 0),
  refunded_amount integer not null default 0 check (refunded_amount between 0 and captured_amount),
  receipt_url text,
  external_invoice_url text,
  created_at timestamptz not null default now()
);
create index orders_customer on orders(customer_id, created_at desc);
create table stripe_events (
  id text primary key,
  order_id uuid not null references orders,
  kind text not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now()
);
create index stripe_events_order on stripe_events(order_id, occurred_at);
create table billing_documents (
  order_id uuid primary key references orders,
  number bigint generated always as identity unique,
  issued_at timestamptz not null default now(),
  snapshot jsonb not null
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references orders,
  status text not null default 'confirmed' check(status in ('confirmed', 'waiting_details', 'received', 'in_progress', 'first_version', 'awaiting_approval', 'revisions', 'finalized', 'published', 'archived')),
  brief jsonb not null default '{}',
  missing_details text not null default '',
  selected_version uuid,
  approved_version uuid,
  published_version uuid,
  share_key text unique,
  share_available_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects,
  label text not null,
  created_at timestamptz not null default now(),
  unique(project_id, id)
);
alter table projects add foreign key (id, selected_version) references versions(project_id, id);
alter table projects add foreign key (id, approved_version) references versions(project_id, id);
alter table projects add foreign key (id, published_version) references versions(project_id, id);
create table version_assets (
  version_id uuid not null references versions on delete cascade,
  path text not null,
  storage_key uuid not null unique,
  media_type text not null,
  primary key(version_id, path)
);
create table messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects,
  from_admin boolean not null,
  sender_id uuid references customers on delete set null,
  content text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index messages_project on messages(project_id, created_at);
create table files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects,
  message_id uuid references messages on delete cascade,
  uploaded_by uuid references customers on delete set null,
  name text not null,
  category text not null,
  media_type text not null,
  size integer not null check (size > 0),
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
create index files_project on files(project_id);
create table events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references projects,
  enabled boolean not null default false,
  event_date date,
  deadline date,
  companions boolean not null default false,
  dietary boolean not null default false,
  notify boolean not null default false,
  max_adults integer not null default 8 check(max_adults between 1 and 30),
  max_children integer not null default 8 check(max_children between 0 and 30),
  check (not dietary or event_date is not null),
  check (deadline is null or event_date is null or deadline <= event_date)
);
create table invitees (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events on delete cascade,
  name text not null,
  key_digest text not null unique,
  created_at timestamptz not null default now(),
  unique(event_id, id)
);
create index invitees_event on invitees(event_id);
create table responses (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events on delete cascade,
  invitee_id uuid,
  response_key_digest text,
  edit_digest text,
  name text not null,
  attending boolean not null,
  adults integer not null check(adults between 0 and 30),
  children integer not null check(children between 0 and 30),
  companions text not null default '',
  message text not null default '',
  dietary text,
  dietary_consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(event_id, invitee_id) references invitees(event_id, id) on delete set null (invitee_id),
  unique(event_id, invitee_id),
  unique(event_id, response_key_digest),
  unique(event_id, edit_digest),
  check ((attending and adults+children>0) or (not attending and adults=0 and children=0)),
  check (dietary is null or dietary_consent_at is not null)
);
create index responses_event on responses(event_id, updated_at desc);

create table timeline (
  id bigint generated always as identity primary key,
  order_id uuid not null references orders,
  actor_id uuid references customers on delete set null,
  kind text not null,
  summary text not null,
  internal boolean not null default false,
  created_at timestamptz not null default now()
);
create index timeline_order on timeline(order_id, created_at desc);
create table notifications (
  id bigint generated always as identity primary key,
  order_id uuid references orders,
  recipient text not null,
  kind text not null,
  content jsonb not null,
  dedup_key text not null unique,
  created_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  attempts integer not null default 0,
  error_code text,
  provider_id text
);
create index notifications_pending on notifications(next_attempt_at) where sent_at is null;
create table inquiries (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  email text not null,
  name text not null,
  fields jsonb not null,
  created_at timestamptz not null default now()
);
create table settings (
  key text primary key,
  value text not null
);
