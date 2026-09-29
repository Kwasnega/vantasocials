drop policy if exists "profiles are editable by their owner"
on public.profiles;

revoke insert, update, delete
on table public.profiles
from anon, authenticated;
