set search_path to makeyourstory, pg_catalog;
alter table projects add column if not exists intake jsonb not null default '{}';
alter table files add column if not exists client_upload_key uuid;
create unique index if not exists files_client_upload_key on files(project_id,client_upload_key) where client_upload_key is not null;
alter table guest_messages add column if not exists read_at timestamptz;
alter table responses add column if not exists organizer_read_at timestamptz;
