import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth';
import { jsonSuccess, jsonError, jsonUnauthorized } from '@/lib/api-response';
import { adjustUserInterests } from '@/lib/algorithm';

/**
 * POST /api/sparks/videos/[id]/report
 * Reports a video.
 * Body: { reason: string, details?: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let authUser;
  try {
    authUser = await requireAuth(req);
  } catch {
    return jsonUnauthorized('Authentication required to report a video.');
  }

  const { id } = await params;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON request body.');
  }

  const reason: string = typeof body.reason === 'string' ? body.reason.trim().slice(0, 100) : '';
  const details: string | null =
    typeof body.details === 'string' ? body.details.trim().slice(0, 2000) : null;

  if (!reason) {
    return jsonError('reason is required.');
  }

  const { error } = await supabaseAdmin.from('sparks_video_reports').upsert(
    {
      video_id: id,
      user_id: authUser.id,
      reason,
      details,
      status: 'pending',
      created_at: new Date().toISOString(),
    },
    { onConflict: 'video_id,user_id' }
  );

  if (error) {
    console.error('[Sparks Report Error]:', error);
    return jsonError('Failed to submit report.', 500, error.message);
  }

  // Decay user interest weights for this content
  const [videoRes, tagsRes] = await Promise.all([
    supabaseAdmin.from('sparks_videos').select('category').eq('id', id).single(),
    supabaseAdmin.from('sparks_video_tags').select('tag').eq('video_id', id),
  ]);

  const category = videoRes.data?.category ?? null;
  const tags = tagsRes.data?.map((t) => t.tag) || [];

  await adjustUserInterests(authUser.id, tags, category, -0.25);

  return jsonSuccess({
    message: 'Report submitted successfully. This video will no longer appear in your feed.',
    video_id: id,
  });
}
