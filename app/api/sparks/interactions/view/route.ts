import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth';
import { jsonSuccess, jsonError, jsonUnauthorized } from '@/lib/api-response';
import { adjustUserInterests } from '@/lib/algorithm';
import { RecordViewInput } from '@/lib/types';

/**
 * POST /api/sparks/interactions/view
 * Records a video view session.
 * STRICT SECURITY: Requires authentication so bots cannot inject fake views.
 * Updates video metrics and dynamically trains user interest weights.
 */
export async function POST(req: NextRequest) {
  let authUser;
  try {
    authUser = await requireAuth(req);
  } catch {
    return jsonUnauthorized('Authentication token required to log video views.');
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON request body.');
  }

  const { video_id, watched_ms, rewatched_ms, completed, source } = body as RecordViewInput;

  if (!video_id) {
    return jsonError('video_id is required.');
  }

  const watched = typeof watched_ms === 'number' && watched_ms >= 0 ? Math.round(watched_ms) : 0;
  const rewatched = typeof rewatched_ms === 'number' && rewatched_ms >= 0 ? Math.round(rewatched_ms) : 0;

  const validSources = ['feed', 'profile', 'share', 'search', 'trending'];
  const viewSource = validSources.includes(source || '') ? source : 'feed';

  // 1. Insert view log tied to the authenticated user
  const { data: viewRecord, error: viewError } = await supabaseAdmin
    .from('sparks_video_views')
    .insert({
      video_id,
      user_id: authUser.id,
      watched_ms: watched,
      rewatched_ms: rewatched,
      completed: Boolean(completed),
      source: viewSource,
      started_at: new Date(Date.now() - (watched + rewatched)).toISOString(),
      ended_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (viewError) {
    console.error('[Sparks View Log Error]:', viewError);
    return jsonError('Failed to record view.', 500, viewError.message);
  }

  // 2. Fetch video duration, category & tags to update user interest feedback loop
  const [videoRes, tagsRes] = await Promise.all([
    supabaseAdmin.from('sparks_videos').select('duration_ms, category').eq('id', video_id).single(),
    supabaseAdmin.from('sparks_video_tags').select('tag').eq('video_id', video_id),
  ]);

  const video = videoRes.data;
  const tags = tagsRes.data?.map((t) => t.tag) || [];

  if (video) {
    let delta = 0.0;
    if (video.duration_ms > 0) {
      const watchRatio = watched / video.duration_ms;
      if (watchRatio >= 0.8 || completed) {
        delta = 0.08; // High watch completion
      } else if (watched < 3000) {
        delta = -0.04; // Quick skip under 3 seconds
      }
    }

    if (rewatched > 0) {
      delta += 0.05; // Looped/rewatched bonus
    }

    if (delta !== 0.0) {
      await adjustUserInterests(authUser.id, tags, video.category, delta);
    }
  }

  return jsonSuccess({ message: 'View recorded successfully.', view_id: viewRecord?.id });
}
