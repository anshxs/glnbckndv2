import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { jsonSuccess, jsonError, jsonUnauthorized } from '@/lib/api-response';
import { fetchPersonalizedFeed } from '@/lib/algorithm';

/**
 * GET /api/sparks/feed
 * High-performance algorithmic feed endpoint.
 *
 * Query Params:
 * - category: (optional) filter by category e.g., 'gaming', 'esports'
 * - limit: (optional) number of videos (1 - 30, default 10)
 * - page: (optional) pagination page offset
 *
 * Algorithm behavior:
 * - Authenticated users:
 *   1. Excludes videos already seen/impressed within the last 7 days.
 *   2. Personalizes based on user interest affinity in sparks_user_interests.
 *   3. Factors in composite quality metrics (completion, share, save, like rates).
 *   4. Applies freshness time-decay.
 *   5. Reserves cold-start exploration slots for new creator uploads (<50 views).
 *   6. Automatically logs impressions so user gets fresh content on future calls.
 *   7. Applies diversity filtering (no consecutive videos from same creator).
 * - Unauthenticated/Guests:
 *   Returns high-quality trending & fresh public videos.
 */
export async function GET(req: NextRequest) {
  let authUser;
  try {
    authUser = await requireAuth(req);
  } catch {
    return jsonUnauthorized('Authentication token required to access the sparks feed.');
  }

  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category');
    const limit = parseInt(searchParams.get('limit') || '10', 10);
    const page = parseInt(searchParams.get('page') || '0', 10);

    const feed = await fetchPersonalizedFeed({
      userId: authUser.id,
      category: category ?? null,
      limit,
      page,
    });

    return jsonSuccess({
      videos: feed,
      count: feed.length,
      page,
      is_personalized: true,
    });
  } catch (err: any) {
    console.error('[Sparks Feed Error]:', err);
    return jsonError('Failed to generate sparks feed.', 500, err?.message);
  }
}
