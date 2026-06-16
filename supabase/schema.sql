-- 在 Supabase SQL Editor 執行此腳本

create table if not exists entries (
  id text primary key,
  date text not null,
  type text not null,
  note text default '',
  scores jsonb not null default '{}',
  created_at bigint not null default 0
);

alter table entries enable row level security;

create policy "entries_read" on entries for select using (true);
create policy "entries_insert" on entries for insert with check (true);
create policy "entries_update" on entries for update using (true);
create policy "entries_delete" on entries for delete using (true);
