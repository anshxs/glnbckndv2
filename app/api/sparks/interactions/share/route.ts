import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth';
import { jsonSuccess, jsonError, jsonUnauthorized } from '@/lib/api-response';
import { adjustUserInterests } from '@/lib/algorithm';
import { RecordShareInput } from '@/lib/types';

/**
 * POST /api/sparks/interactions/share
 * Records a video share event.
 * Body: { video_id: string, share_type: string }
 */
export async function POST(req: NextRequest) {
  let authUser;
  try {
    authUser = await requireAuth(req);
  } catch {
    return jsonUnauthorized('Authentication required to record a share.');
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON request body.');
  }

  const { video_id, share_type } = body as RecordShareInput;

  if (!video_id) {
    return jsonError('video_id is required.');
  }

  const validTypes = [
    'internal_share',
    'copy_link',
    'whatsapp',
    'instagram',
    'telegram',
    'system_share',
    'dm',
  ];
  const type = validTypes.includes(share_type) ? share_type : 'system_share';

  const { error: insertError } = await supabaseAdmin
    .from('sparks_video_shares')
    .insert({
      video_id,
      user_id: authUser.id,
      share_type: type,
      created_at: new Date().toISOString(),
    });

  if (insertError) {
    console.error('[Sparks Share Error]:', insertError);
    return jsonError('Failed to record share.', 500, insertError.message);
  }

  const { data: videoData } = await supabaseAdmin
    .from('sparks_videos')
    .select('share_count, category')
    .eq('id', video_id)
    .single();

  if (videoData) {
    const { data: tagRows } = await supabaseAdmin
      .from('sparks_video_tags')
      .select('tag')
      .eq('video_id', video_id);
    const tags = tagRows?.map((t) => t.tag) || [];

    // Shares are strongest positive intent signal (+0.15)
    await adjustUserInterests(authUser.id, tags, videoData.category, 0.15);
  }

  return jsonSuccess({
    video_id,
    share_count: videoData?.share_count ?? 0,
    share_type: type,
  });
}
