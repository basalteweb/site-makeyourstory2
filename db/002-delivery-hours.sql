alter table makeyourstory.orders add column if not exists delivery_hours integer
  check (delivery_hours between 1 and 2160);
