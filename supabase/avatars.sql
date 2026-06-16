-- 若你已經跑過 schema.sql，只需在 SQL Editor 執行這份

create table if not exists player_avatars (
  player_id text primary key,
  avatar_url text not null,
  updated_at bigint not null default 0
);

alter table player_avatars enable row level security;

drop policy if exists "player_avatars_read" on player_avatars;
drop policy if exists "player_avatars_insert" on player_avatars;
drop policy if exists "player_avatars_update" on player_avatars;

create policy "player_avatars_read" on player_avatars for select using (true);
create policy "player_avatars_insert" on player_avatars for insert with check (true);
create policy "player_avatars_update" on player_avatars for update using (true);

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
