import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth';
import { jsonSuccess, jsonError, jsonNotFound, jsonForbidden, jsonUnauthorized } from '@/lib/api-response';

/**
 * DELETE /api/sparks/comments/[id]
 * Deletes a comment (soft delete).
 * Only the comment author or video creator can delete.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let authUser;
  try {
    authUser = await requireAuth(req);
  } catch {
    return jsonUnauthorized();
  }

  const { id } = await params;

  const { data: comment } = await supabaseAdmin
    .from('sparks_comments')
    .select('user_id, video_id')
    .eq('id', id)
    .maybeSingle();

  if (!comment) {
    return jsonNotFound('Comment not found.');
  }

  // Check if caller is comment author or video creator
  let isAllowed = comment.user_id === authUser.id;
  if (!isAllowed) {
    const { data: video } = await supabaseAdmin
      .from('sparks_videos')
      .select('creator_id')
      .eq('id', comment.video_id)
      .maybeSingle();
    if (video && video.creator_id === authUser.id) {
      isAllowed = true;
    }
  }

  if (!isAllowed) {
    return jsonForbidden('You are not authorized to delete this comment.');
  }

  const { error } = await supabaseAdmin
    .from('sparks_comments')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    return jsonError('Failed to delete comment.', 500, error.message);
  }

  return jsonSuccess({ message: 'Comment deleted successfully.', id });
}
