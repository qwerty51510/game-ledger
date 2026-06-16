-- 表已存在但 API 仍 404 时，在 SQL Editor 执行此脚本
-- 原因：新版 Supabase 需要显式 GRANT，RLS 不够

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on public.entries to anon, authenticated;
grant select, insert, update, delete on public.player_avatars to anon, authenticated;

-- 若仍 404，到 Dashboard → Integrations → Data API → Settings
-- 确认 Exposed schemas 包含 public，且 entries / player_avatars 已开启
