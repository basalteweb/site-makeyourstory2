-- Retouched photographs remain private; the client's original is retained.
alter table makeyourstory.files add column if not exists source_file_id uuid references makeyourstory.files(id) on delete set null;
alter table makeyourstory.versions add column if not exists studio_save_key uuid;
create unique index if not exists studio_save_requests on makeyourstory.versions(project_id,studio_save_key) where studio_save_key is not null;
