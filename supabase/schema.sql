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

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.entries to anon, authenticated;

create policy "entries_read" on entries for select using (true);
create policy "entries_insert" on entries for insert with check (true);
create policy "entries_update" on entries for update using (true);
create policy "entries_delete" on entries for delete using (true);

-- 參賽者頭像（雲端同步）
create table if not exists player_avatars (
  player_id text primary key,
  avatar_url text not null,
  updated_at bigint not null default 0
);

alter table player_avatars enable row level security;

grant select, insert, update, delete on public.player_avatars to anon, authenticated;

create policy "player_avatars_read" on player_avatars for select using (true);
create policy "player_avatars_insert" on player_avatars for insert with check (true);
create policy "player_avatars_update" on player_avatars for update using (true);

-- Storage bucket（頭像圖片）
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 524288, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public = true, file_size_limit = 524288;

drop policy if exists "avatars_public_read" on storage.objects;
drop policy if exists "avatars_public_insert" on storage.objects;
drop policy if exists "avatars_public_update" on storage.objects;

create policy "avatars_public_read" on storage.objects
  for select using (bucket_id = 'avatars');
create policy "avatars_public_insert" on storage.objects
  for insert with check (bucket_id = 'avatars');
create policy "avatars_public_update" on storage.objects
  for update using (bucket_id = 'avatars');
