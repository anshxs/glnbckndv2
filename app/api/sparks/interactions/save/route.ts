import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth';
import { jsonSuccess, jsonError, jsonUnauthorized } from '@/lib/api-response';
import { adjustUserInterests } from '@/lib/algorithm';

/**
 * POST /api/sparks/interactions/save
 * Toggles save/bookmark on a video.
 * Body: { video_id: string }
 */
export async function POST(req: NextRequest) {
  let authUser;
  try {
    authUser = await requireAuth(req);
  } catch {
    return jsonUnauthorized('Authentication required to save a video.');
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON request body.');
  }

  const { video_id } = body;
  if (!video_id) {
    return jsonError('video_id is required.');
  }

  const { data: existingSave } = await supabaseAdmin
    .from('sparks_video_saves')
    .select('created_at')
    .eq('user_id', authUser.id)
    .eq('video_id', video_id)
    .maybeSingle();

  let isSaved = false;

  if (existingSave) {
    // Unsave
    await supabaseAdmin
      .from('sparks_video_saves')
      .delete()
      .eq('user_id', authUser.id)
      .eq('video_id', video_id);
    isSaved = false;
  } else {
    // Save
    await supabaseAdmin
      .from('sparks_video_saves')
      .insert({
        user_id: authUser.id,
        video_id,
        created_at: new Date().toISOString(),
      });
    isSaved = true;
  }

  const { data: videoData } = await supabaseAdmin
    .from('sparks_videos')
    .select('save_count, category')
    .eq('id', video_id)
    .single();

  if (videoData) {
    const { data: tagRows } = await supabaseAdmin
      .from('sparks_video_tags')
      .select('tag')
      .eq('video_id', video_id);
    const tags = tagRows?.map((t) => t.tag) || [];

    await adjustUserInterests(
      authUser.id,
      tags,
      videoData.category,
      isSaved ? 0.15 : -0.05
    );
  }

  return jsonSuccess({
    video_id,
    is_saved: isSaved,
    save_count: videoData?.save_count ?? 0,
  });
}
