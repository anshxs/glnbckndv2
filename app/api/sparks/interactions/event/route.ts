import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth';
import { jsonSuccess, jsonError, jsonUnauthorized } from '@/lib/api-response';
import { adjustUserInterests } from '@/lib/algorithm';
import { RecordFeedEventInput } from '@/lib/types';

/**
 * POST /api/sparks/interactions/event
 * Records feed events (skip, not_interested, loop, pause, etc.).
 * STRICT SECURITY: Requires authentication to prevent fake event logging.
 */
export async function POST(req: NextRequest) {
  let authUser;
  try {
    authUser = await requireAuth(req);
  } catch {
    return jsonUnauthorized('Authentication token required to log feed events.');
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON request body.');
  }

  const { video_id, event_type, watch_ms, metadata } = body as RecordFeedEventInput;

  if (!video_id || !event_type) {
    return jsonError('video_id and event_type are required.');
  }

  const { error } = await supabaseAdmin.from('sparks_feed_events').insert({
    video_id,
    user_id: authUser.id,
    event_type: event_type.slice(0, 50),
    watch_ms: typeof watch_ms === 'number' ? Math.round(watch_ms) : null,
    metadata: metadata || null,
    created_at: new Date().toISOString(),
  });

  if (error) {
    console.error('[Feed Event Error]:', error);
    return jsonError('Failed to record feed event.', 500, error.message);
  }

  // Adjust interests on negative actions
  if (event_type === 'not_interested') {
    const [videoRes, tagsRes] = await Promise.all([
      supabaseAdmin.from('sparks_videos').select('category').eq('id', video_id).single(),
      supabaseAdmin.from('sparks_video_tags').select('tag').eq('video_id', video_id),
    ]);
    const category = videoRes.data?.category ?? null;
    const tags = tagsRes.data?.map((t) => t.tag) || [];

    // Strong negative signal on not_interested (-0.25)
    await adjustUserInterests(authUser.id, tags, category, -0.25);
  }

  return jsonSuccess({ message: 'Event logged successfully.' });
}
