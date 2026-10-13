import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAuth, getAuthenticatedUser } from '@/lib/auth';
import { jsonSuccess, jsonError, jsonUnauthorized } from '@/lib/api-response';
import { CreateCommentInput } from '@/lib/types';

/**
 * GET /api/sparks/videos/[id]/comments
 * Fetch comments for a video with user profile details.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let authUser;
  try {
    authUser = await requireAuth(req);
  } catch {
    return jsonUnauthorized('Authentication token required to view comments.');
  }

  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '20', 10), 1), 50);
  const page = Math.max(parseInt(searchParams.get('page') || '0', 10), 0);

  const { data: comments, error } = await supabaseAdmin
    .from('sparks_comments')
    .select('*')
    .eq('video_id', id)
    .is('parent_comment_id', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(page * limit, page * limit + limit - 1);

  if (error) {
    return jsonError('Failed to fetch comments.', 500, error.message);
  }

  if (!comments || comments.length === 0) {
    return jsonSuccess({ comments: [], count: 0 });
  }

  // Fetch author details and user like status
  const userIds = Array.from(new Set(comments.map((c) => c.user_id)));
  const commentIds = comments.map((c) => c.id);

  const [usersRes, likesRes] = await Promise.all([
    supabaseAdmin
      .from('sensitive_userdata')
      .select('id, username, name, avatarurl, is_bluetick, is_redtick')
      .in('id', userIds),
    supabaseAdmin
      .from('sparks_comment_likes')
      .select('comment_id')
      .eq('user_id', authUser.id)
      .in('comment_id', commentIds),
  ]);

  const userMap = new Map<string, any>();
  usersRes.data?.forEach((u) => userMap.set(u.id, u));

  const likedSet = new Set<string>();
  likesRes.data?.forEach((l) => likedSet.add(l.comment_id));

  const enriched = comments.map((c) => ({
    ...c,
    author: userMap.get(c.user_id) || null,
    is_liked: likedSet.has(c.id),
  }));

  return jsonSuccess({ comments: enriched, count: enriched.length });
}

/**
 * POST /api/sparks/videos/[id]/comments
 * Add a comment to a video.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let authUser;
  try {
    authUser = await requireAuth(req);
  } catch {
    return jsonUnauthorized('Authentication required to comment.');
  }

  const { id } = await params;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON request body.');
  }

  const { content, gif_url, parent_comment_id } = body as CreateCommentInput;

  const trimmedContent = typeof content === 'string' ? content.trim().slice(0, 1000) : null;
  const trimmedGif = typeof gif_url === 'string' && /^https?:\/\//i.test(gif_url) ? gif_url.trim() : null;

  if (!trimmedContent && !trimmedGif) {
    return jsonError('Comment must have content or a valid gif_url.');
  }

  // Insert comment
  const { data: newComment, error } = await supabaseAdmin
    .from('sparks_comments')
    .insert({
      video_id: id,
      user_id: authUser.id,
      content: trimmedContent,
      gif_url: trimmedGif,
      parent_comment_id: parent_comment_id || null,
      like_count: 0,
      reply_count: 0,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error || !newComment) {
    console.error('[Create Comment Error]:', error);
    return jsonError('Failed to post comment.', 500, error?.message);
  }

  // Fetch author profile
  const { data: author } = await supabaseAdmin
    .from('sensitive_userdata')
    .select('id, username, name, avatarurl, is_bluetick, is_redtick')
    .eq('id', authUser.id)
    .single();

  return jsonSuccess(
    {
      ...newComment,
      author: author || null,
      is_liked: false,
    },
    201
  );
}
