-- Phase 2B: seed the existing VANTA frontend catalog. Prices are provisional VANTA catalog rates.
with seed (platform_slug, slug, name, target_type) as (
  values
    ('instagram', 'instagram-followers', 'Followers', 'username'::public.target_type),
    ('instagram', 'instagram-likes', 'Likes', 'url'::public.target_type),
    ('instagram', 'instagram-views', 'Views', 'url'::public.target_type),
    ('instagram', 'instagram-comments', 'Comments', 'url'::public.target_type),
    ('instagram', 'instagram-saves', 'Saves', 'url'::public.target_type),
    ('tiktok', 'tiktok-followers', 'Followers', 'username'::public.target_type),
    ('tiktok', 'tiktok-likes', 'Likes', 'url'::public.target_type),
    ('tiktok', 'tiktok-views', 'Views', 'url'::public.target_type),
    ('tiktok', 'tiktok-shares', 'Shares', 'url'::public.target_type),
    ('tiktok', 'tiktok-comments', 'Comments', 'url'::public.target_type),
    ('youtube', 'youtube-subscribers', 'Subscribers', 'channel'::public.target_type),
    ('youtube', 'youtube-views', 'Views', 'url'::public.target_type),
    ('youtube', 'youtube-likes', 'Likes', 'url'::public.target_type),
    ('youtube', 'youtube-comments', 'Comments', 'url'::public.target_type),
    ('facebook', 'facebook-page-followers', 'Page followers', 'page'::public.target_type),
    ('facebook', 'facebook-page-likes', 'Page likes', 'page'::public.target_type),
    ('facebook', 'facebook-post-likes', 'Post likes', 'url'::public.target_type),
    ('facebook', 'facebook-reactions', 'Reactions', 'url'::public.target_type),
    ('facebook', 'facebook-video-views', 'Video views', 'url'::public.target_type),
    ('x', 'x-followers', 'Followers', 'username'::public.target_type),
    ('x', 'x-likes', 'Likes', 'url'::public.target_type),
    ('x', 'x-reposts', 'Reposts', 'url'::public.target_type),
    ('x', 'x-post-views', 'Post views', 'url'::public.target_type),
    ('telegram', 'telegram-channel-members', 'Channel members', 'channel'::public.target_type),
    ('telegram', 'telegram-post-views', 'Post views', 'url'::public.target_type),
    ('telegram', 'telegram-reactions', 'Reactions', 'url'::public.target_type)
)
insert into public.services (
  platform_id, name, slug, category, target_type, min_quantity, max_quantity,
  selling_rate, currency, active
)
select platforms.id, seed.name, seed.slug, seed.name, seed.target_type, 100, 100000,
  0.010000, 'GHS', true
from seed
join public.platforms on platforms.slug = seed.platform_slug
on conflict (slug) do update set
  platform_id = excluded.platform_id,
  name = excluded.name,
  category = excluded.category,
  target_type = excluded.target_type,
  min_quantity = excluded.min_quantity,
  max_quantity = excluded.max_quantity,
  selling_rate = excluded.selling_rate,
  currency = excluded.currency,
  active = excluded.active;
