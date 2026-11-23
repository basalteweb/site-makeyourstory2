alter table makeyourstory.projects add column if not exists studio_draft jsonb not null default '{}';
alter table makeyourstory.events add column if not exists settings_saved_at timestamptz;
update makeyourstory.events e set settings_saved_at=now() where settings_saved_at is null
  and (enabled or questions<>'[]'::jsonb or title<>'' or practical<>'' or exists(select 1 from makeyourstory.responses r where r.event_id=e.id));
