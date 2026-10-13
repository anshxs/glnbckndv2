import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth';
import { jsonSuccess, jsonError, jsonUnauthorized } from '@/lib/api-response';
import { adjustUserInterests } from '@/lib/algorithm';

/**
 * POST /api/sparks/interactions/like
 * Toggles like on a video.
 * Body: { video_id: string }
 */
export async function POST(req: NextRequest) {
  let authUser;
  try {
    authUser = await requireAuth(req);
  } catch {
    return jsonUnauthorized('Authentication required to like a video.');
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON request body.');
  }

  const { video_id, target_state, is_liked: reqIsLiked } = body;
  if (!video_id) {
    return jsonError('video_id is required.');
  }

  const desiredState = typeof target_state === 'boolean'
    ? target_state
    : (typeof reqIsLiked === 'boolean' ? reqIsLiked : undefined);

  // Check if already liked
  const { data: existingLike } = await supabaseAdmin
    .from('sparks_video_likes')
    .select('created_at')
    .eq('user_id', authUser.id)
    .eq('video_id', video_id)
    .maybeSingle();

  let isLiked = false;

  if (desiredState !== undefined) {
    if (desiredState) {
      if (!existingLike) {
        await supabaseAdmin
          .from('sparks_video_likes')
          .insert({
            user_id: authUser.id,
            video_id,
            created_at: new Date().toISOString(),
          });
      }
      isLiked = true;
    } else {
      if (existingLike) {
        await supabaseAdmin
          .from('sparks_video_likes')
          .delete()
          .eq('user_id', authUser.id)
          .eq('video_id', video_id);
      }
      isLiked = false;
    }
  } else {
    if (existingLike) {
      // Unlike
      await supabaseAdmin
        .from('sparks_video_likes')
        .delete()
        .eq('user_id', authUser.id)
        .eq('video_id', video_id);
      isLiked = false;
    } else {
      // Like
      await supabaseAdmin
        .from('sparks_video_likes')
        .insert({
          user_id: authUser.id,
          video_id,
          created_at: new Date().toISOString(),
        });
      isLiked = true;
    }
  }

  // Fetch updated like count
  const { data: videoData } = await supabaseAdmin
    .from('sparks_videos')
    .select('like_count, category')
    .eq('id', video_id)
    .single();

  // Update user interest feedback loop
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
      isLiked ? 0.10 : -0.05
    );
  }

  return jsonSuccess({
    video_id,
    is_liked: isLiked,
    like_count: videoData?.like_count ?? 0,
  });
}
