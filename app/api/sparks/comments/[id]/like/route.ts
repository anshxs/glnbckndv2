import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth';
import { jsonSuccess, jsonError, jsonUnauthorized } from '@/lib/api-response';

/**
 * POST /api/sparks/comments/[id]/like
 * Toggles like on a comment.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let authUser;
  try {
    authUser = await requireAuth(req);
  } catch {
    return jsonUnauthorized('Authentication required to like comment.');
  }

  const { id } = await params;

  // Check if already liked
  const { data: existingLike } = await supabaseAdmin
    .from('sparks_comment_likes')
    .select('comment_id')
    .eq('comment_id', id)
    .eq('user_id', authUser.id)
    .maybeSingle();

  let isLiked = false;

  if (existingLike) {
    // Unlike
    await supabaseAdmin
      .from('sparks_comment_likes')
      .delete()
      .eq('comment_id', id)
      .eq('user_id', authUser.id);
    isLiked = false;
  } else {
    // Like
    await supabaseAdmin
      .from('sparks_comment_likes')
      .insert({
        comment_id: id,
        user_id: authUser.id,
        created_at: new Date().toISOString(),
      });
    isLiked = true;
  }

  const { data: comment } = await supabaseAdmin
    .from('sparks_comments')
    .select('like_count')
    .eq('id', id)
    .single();

  return jsonSuccess({
    comment_id: id,
    is_liked: isLiked,
    like_count: comment?.like_count ?? 0,
  });
}
