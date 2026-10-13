import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAuth, getAuthenticatedUser } from '@/lib/auth';
import {
  jsonSuccess,
  jsonError,
  jsonNotFound,
  jsonForbidden,
  jsonUnauthorized,
} from '@/lib/api-response';
import { extractHashtags, enrichVideoRecords } from '@/lib/algorithm';

/**
 * GET /api/sparks/videos/[id]
 * Fetch single video by ID.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let authUser;
  try {
    authUser = await requireAuth(req);
  } catch {
    return jsonUnauthorized('Authentication token required to fetch video details.');
  }

  const { id } = await params;

  const { data: video, error } = await supabaseAdmin
    .from('sparks_videos')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error || !video) {
    return jsonNotFound('Video not found.');
  }

  // Check visibility permissions
  if (video.visibility === 'private' && authUser.id !== video.creator_id) {
    return jsonForbidden('This video is private.');
  }

  const [enriched] = await enrichVideoRecords([video], authUser.id);
  return jsonSuccess(enriched);
}

/**
 * PATCH /api/sparks/videos/[id]
 * Update video metadata (caption, thumbnail_url, category, visibility).
 * Creator only!
 */
export async function PATCH(
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

  // Verify ownership
  const { data: existing, error: findError } = await supabaseAdmin
    .from('sparks_videos')
    .select('creator_id')
    .eq('id', id)
    .maybeSingle();

  if (findError || !existing) {
    return jsonNotFound('Video not found.');
  }

  if (existing.creator_id !== authUser.id) {
    return jsonForbidden('You are not authorized to edit this video.');
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON request body.');
  }

  const updates: Record<string, any> = {
    updated_at: new Date().toISOString(),
  };

  if (typeof body.caption === 'string') {
    updates.caption = body.caption.trim().slice(0, 2200);
  }

  if (typeof body.thumbnail_url === 'string') {
    if (!/^https?:\/\//i.test(body.thumbnail_url)) {
      return jsonError('thumbnail_url must be a valid http/https URL.');
    }
    updates.thumbnail_url = body.thumbnail_url.trim();
  }

  if (typeof body.category === 'string') {
    updates.category = body.category.trim().slice(0, 50);
  }

  if (['public', 'private', 'followers_only'].includes(body.visibility)) {
    updates.visibility = body.visibility;
  }

  const { data: updatedVideo, error: updateError } = await supabaseAdmin
    .from('sparks_videos')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (updateError || !updatedVideo) {
    return jsonError('Failed to update video.', 500, updateError?.message);
  }

  // Update tags if caption was changed
  if (typeof updates.caption !== 'undefined') {
    const newTags = extractHashtags(updates.caption);
    await supabaseAdmin.from('sparks_video_tags').delete().eq('video_id', id);
    if (newTags.length > 0) {
      const rows = newTags.map((t) => ({
        video_id: id,
        tag: t,
        source: 'creator',
      }));
      await supabaseAdmin.from('sparks_video_tags').insert(rows);
    }
  }

  const [enriched] = await enrichVideoRecords([updatedVideo], authUser.id);
  return jsonSuccess(enriched);
}

/**
 * DELETE /api/sparks/videos/[id]
 * Delete video (soft-delete status = 'deleted').
 * Creator only!
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

  const { data: existing } = await supabaseAdmin
    .from('sparks_videos')
    .select('creator_id')
    .eq('id', id)
    .maybeSingle();

  if (!existing) {
    return jsonNotFound('Video not found.');
  }

  if (existing.creator_id !== authUser.id) {
    return jsonForbidden('You can only delete your own videos.');
  }

  const { error } = await supabaseAdmin
    .from('sparks_videos')
    .update({ status: 'deleted', updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    return jsonError('Failed to delete video.', 500, error.message);
  }

  return jsonSuccess({ message: 'Video deleted successfully.', id });
}
