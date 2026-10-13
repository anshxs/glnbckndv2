import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAuth, getAuthenticatedUser } from '@/lib/auth';
import { jsonSuccess, jsonError, jsonUnauthorized } from '@/lib/api-response';
import { extractHashtags, enrichVideoRecords } from '@/lib/algorithm';
import { CreateSparkVideoInput } from '@/lib/types';

/**
 * POST /api/sparks/videos
 * Creates a new spark video.
 * STRICT SECURITY:
 * Only accepts: video_url, thumbnail_url, caption, category, audio_id, visibility.
 * Other values (view_count, like_count, etc.) are strictly stripped/disallowed.
 * creator_id is injected from the authenticated user JWT.
 */
export async function POST(req: NextRequest) {
  let authUser;
  try {
    authUser = await requireAuth(req);
  } catch {
    return jsonUnauthorized('Authentication token required to upload a video.');
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON request body.');
  }

  // 1. Strict payload extraction (whitelist ONLY allowed fields)
  const video_url: string = typeof body.video_url === 'string' ? body.video_url.trim() : '';
  const thumbnail_url: string | null =
    typeof body.thumbnail_url === 'string' && body.thumbnail_url.trim().length > 0
      ? body.thumbnail_url.trim()
      : null;
  const caption: string | null =
    typeof body.caption === 'string' ? body.caption.trim().slice(0, 2200) : null;
  const category: string =
    typeof body.category === 'string' && body.category.trim().length > 0
      ? body.category.trim().slice(0, 50)
      : 'gaming';
  const audio_id: string | null =
    typeof body.audio_id === 'string' && body.audio_id.trim().length > 0
      ? body.audio_id.trim().slice(0, 100)
      : null;

  const validVisibilities = ['public', 'private', 'followers_only'];
  const visibility = validVisibilities.includes(body.visibility) ? body.visibility : 'public';

  const duration_ms =
    typeof body.duration_ms === 'number' && body.duration_ms >= 0 && body.duration_ms <= 300000
      ? Math.round(body.duration_ms)
      : 0;

  // 2. Validation
  if (!video_url || !/^https?:\/\//i.test(video_url)) {
    return jsonError('video_url is required and must be a valid http/https URL.');
  }

  if (thumbnail_url && !/^https?:\/\//i.test(thumbnail_url)) {
    return jsonError('thumbnail_url must be a valid http/https URL.');
  }

  // 3. Insert video using service role client
  const insertPayload = {
    creator_id: authUser.id,
    video_url,
    thumbnail_url,
    caption,
    category,
    audio_id,
    visibility,
    duration_ms,
    // Counters are strictly 0 and system managed
    view_count: 0,
    like_count: 0,
    comment_count: 0,
    share_count: 0,
    save_count: 0,
    status: 'active',
    moderation_status: 'approved',
  };

  const { data: video, error: insertError } = await supabaseAdmin
    .from('sparks_videos')
    .insert(insertPayload)
    .select()
    .single();

  if (insertError || !video) {
    console.error('[Sparks Upload Error]:', insertError);
    return jsonError('Failed to create video record in database.', 500, insertError?.message);
  }

  // 4. Extract and insert tags from caption (#tag) and optional payload tags
  const extractedTags = extractHashtags(caption);
  const payloadTags = Array.isArray(body.tags)
    ? body.tags.filter((t: any) => typeof t === 'string' && /^[a-zA-Z0-9_\-]+$/.test(t.trim()))
    : [];
  const allTags = Array.from(new Set([...extractedTags, ...payloadTags])).slice(0, 15);

  if (allTags.length > 0) {
    const tagRows = allTags.map((tag) => ({
      video_id: video.id,
      tag: tag.toLowerCase(),
      source: 'creator',
    }));
    await supabaseAdmin.from('sparks_video_tags').upsert(tagRows, { onConflict: 'video_id,tag' });
  }

  // 5. Initialize video metrics row
  await supabaseAdmin.from('sparks_video_metrics').upsert({
    video_id: video.id,
    total_views: 0,
    unique_viewers: 0,
    total_watch_ms: 0,
    avg_watch_ms: 0,
    avg_watch_pct: 0,
    completion_rate: 0,
    rewatch_rate: 0,
    like_rate: 0,
    comment_rate: 0,
    share_rate: 0,
    save_rate: 0,
    skip_rate: 0,
    updated_at: new Date().toISOString(),
  });

  const [enriched] = await enrichVideoRecords([video], authUser.id);
  return jsonSuccess(enriched, 201);
}

/**
 * GET /api/sparks/videos
 * List public videos with optional query filters (creator_id, category, limit, page).
 */
export async function GET(req: NextRequest) {
  let authUser;
  try {
    authUser = await requireAuth(req);
  } catch {
    return jsonUnauthorized('Authentication token required to fetch videos.');
  }

  const { searchParams } = new URL(req.url);
  const creatorId = searchParams.get('creator_id');
  const category = searchParams.get('category');
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '20', 10), 1), 50);
  const page = Math.max(parseInt(searchParams.get('page') || '0', 10), 0);

  let query = supabaseAdmin
    .from('sparks_videos')
    .select('*')
    .eq('status', 'active')
    .eq('moderation_status', 'approved');

  if (creatorId) {
    query = query.eq('creator_id', creatorId);
    // If not caller's own videos, only allow public visibility
    if (authUser.id !== creatorId) {
      query = query.eq('visibility', 'public');
    }
  } else {
    query = query.eq('visibility', 'public');
  }

  if (category) {
    query = query.eq('category', category);
  }

  query = query
    .order('created_at', { ascending: false })
    .range(page * limit, page * limit + limit - 1);

  const { data: videos, error } = await query;
  if (error) {
    return jsonError('Failed to fetch videos.', 500, error.message);
  }

  const enriched = await enrichVideoRecords(videos || [], authUser.id);
  return jsonSuccess(enriched);
}
