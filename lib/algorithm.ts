import { supabaseAdmin } from './supabase';
import { SparkVideoRecord } from './types';

/**
 * Extracts hashtags from caption text.
 * E.g., "Check this clutch in #BGMI with #headshot!" -> ['bgmi', 'headshot']
 */
export function extractHashtags(caption?: string | null): string[] {
  if (!caption) return [];
  const regex = /#([a-zA-Z0-9_\-]+)/g;
  const matches = caption.match(regex);
  if (!matches) return [];

  const tags = matches
    .map((tag) => tag.substring(1).toLowerCase().trim())
    .filter((tag) => tag.length >= 1 && tag.length <= 50);

  return Array.from(new Set(tags));
}

/**
 * Adjusts user's interest affinity in sparks_user_interests for tags and category.
 * Delta can be positive (e.g. +0.08 on full watch, +0.10 on like, +0.15 on share)
 * or negative (e.g. -0.04 on quick skip, -0.25 on not_interested/report).
 */
export async function adjustUserInterests(
  userId: string,
  tags: string[],
  category: string | null,
  delta: number
) {
  if (!userId || delta === 0) return;

  const targets = new Set<string>();
  if (category) targets.add(category.toLowerCase().trim());
  tags.forEach((t) => targets.add(t.toLowerCase().trim()));

  for (const interest of targets) {
    if (!interest) continue;
    try {
      // Fetch current weight or default to 0.5
      const { data: existing } = await supabaseAdmin
        .from('sparks_user_interests')
        .select('weight')
        .eq('user_id', userId)
        .eq('interest', interest)
        .maybeSingle();

      const currentWeight = existing ? existing.weight : 0.5;
      const newWeight = Math.min(1.0, Math.max(0.0, currentWeight + delta));

      await supabaseAdmin.from('sparks_user_interests').upsert(
        {
          user_id: userId,
          interest,
          weight: newWeight,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,interest' }
      );
    } catch (err) {
      console.error(`[Interest Update Error] Failed for interest ${interest}:`, err);
    }
  }
}

/**
 * Records impressions in sparks_video_impressions so that the user
 * is not repeatedly served the same videos in upcoming feed fetches.
 */
export async function recordImpressions(userId: string, videoIds: string[]) {
  if (!userId || videoIds.length === 0) return;

  const rows = videoIds.map((video_id) => ({
    user_id: userId,
    video_id,
    shown_at: new Date().toISOString(),
    watch_ms: 0,
  }));

  try {
    await supabaseAdmin.from('sparks_video_impressions').insert(rows);
  } catch (err) {
    console.error('[Impression Error] Failed to log impressions:', err);
  }
}

/**
 * Builds and ranks personalized Sparks feed for an authenticated user.
 */
export async function fetchPersonalizedFeed({
  userId,
  category,
  limit = 10,
  page = 0,
}: {
  userId: string;
  category?: string | null;
  limit?: number;
  page?: number;
}): Promise<SparkVideoRecord[]> {
  const actualLimit = Math.min(Math.max(limit, 1), 30);
  const offset = page * actualLimit;

  // Try calling the PostgreSQL stored procedure get_personalized_sparks_feed if available
  if (userId) {
    try {
      const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
        'get_personalized_sparks_feed',
        {
          p_user_id: userId,
          p_category: category || null,
          p_limit: actualLimit,
          p_offset: offset,
        }
      );

      if (!rpcError && Array.isArray(rpcData) && rpcData.length > 0) {
        // Enrich RPC data with creator details and tags
        const enriched = await enrichVideoRecords(rpcData, userId);
        // Record impressions asynchronously
        recordImpressions(
          userId,
          enriched.map((v) => v.id)
        );
        return enforceFeedDiversity(enriched);
      }
    } catch (rpcErr) {
      console.warn('[Feed RPC fallback] Stored procedure unavailable or error, falling back to app query:', rpcErr);
    }
  }

  // Application-level algorithm query fallback
  // 1. Get IDs of videos user has already seen in the last 7 days (or reported)
  let excludedIds: string[] = [];
  let userInterestsMap: Map<string, number> = new Map();

  if (userId) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [impressionsRes, viewsRes, reportsRes, interestsRes] = await Promise.all([
      supabaseAdmin
        .from('sparks_video_impressions')
        .select('video_id')
        .eq('user_id', userId)
        .gte('shown_at', sevenDaysAgo),
      supabaseAdmin
        .from('sparks_video_views')
        .select('video_id')
        .eq('user_id', userId)
        .gte('started_at', sevenDaysAgo),
      supabaseAdmin.from('sparks_video_reports').select('video_id').eq('user_id', userId),
      supabaseAdmin.from('sparks_user_interests').select('interest, weight').eq('user_id', userId),
    ]);

    const seenSet = new Set<string>();
    impressionsRes.data?.forEach((r) => seenSet.add(r.video_id));
    viewsRes.data?.forEach((r) => seenSet.add(r.video_id));
    reportsRes.data?.forEach((r) => seenSet.add(r.video_id));
    excludedIds = Array.from(seenSet);

    interestsRes.data?.forEach((r) => {
      userInterestsMap.set(r.interest.toLowerCase(), r.weight);
    });
  }

  // 2. Fetch candidates
  let query = supabaseAdmin
    .from('sparks_videos')
    .select(`
      *,
      metrics:sparks_video_metrics(*)
    `)
    .eq('status', 'active')
    .eq('moderation_status', 'approved')
    .eq('visibility', 'public');

  if (category) {
    query = query.eq('category', category);
  }

  if (excludedIds.length > 0) {
    // Only exclude if we don't accidentally starve the feed
    query = query.not('id', 'in', `(${excludedIds.slice(0, 100).join(',')})`);
  }

  query = query.order('created_at', { ascending: false }).limit(actualLimit * 3);

  const { data: candidates, error } = await query;
  if (error || !candidates || candidates.length === 0) {
    // If exclusion caused empty results, fallback to fetching recent public videos without exclusion
    const { data: fallbackVideos } = await supabaseAdmin
      .from('sparks_videos')
      .select('*, metrics:sparks_video_metrics(*)')
      .eq('status', 'active')
      .eq('moderation_status', 'approved')
      .eq('visibility', 'public')
      .order('created_at', { ascending: false })
      .limit(actualLimit);

    if (!fallbackVideos || fallbackVideos.length === 0) return [];
    return enrichVideoRecords(fallbackVideos, userId);
  }

  // 3. Score candidates using composite algorithm
  const now = Date.now();
  const scored = candidates.map((video) => {
    const metrics = Array.isArray(video.metrics) ? video.metrics[0] : video.metrics;

    // Quality Score (0 to 1)
    const completionRate = metrics?.completion_rate ?? 0;
    const shareRate = metrics?.share_rate ?? 0;
    const saveRate = metrics?.save_rate ?? 0;
    const likeRate = metrics?.like_rate ?? 0;
    const skipRate = metrics?.skip_rate ?? 0;

    const qualityScore = Math.max(
      0,
      completionRate * 0.3 + shareRate * 0.3 + saveRate * 0.2 + likeRate * 0.2 - skipRate * 0.2
    );

    // Freshness decay: 72 hour half-life
    const ageSeconds = Math.max(0, (now - new Date(video.created_at).getTime()) / 1000);
    const freshnessScore = Math.exp(-0.693 * (ageSeconds / 259200));

    // Cold-start exploration boost for fresh uploads (<50 views)
    const explorationScore = (video.view_count || 0) < 50 ? 0.35 : 0.0;

    // Personal affinity score
    let affinityScore = 0.1;
    if (userId && userInterestsMap.size > 0) {
      if (video.category && userInterestsMap.has(video.category.toLowerCase())) {
        affinityScore += userInterestsMap.get(video.category.toLowerCase())! * 0.5;
      }
    }

    // Final Composite Score:
    // 40% Personal Affinity + 30% Quality + 20% Freshness + 10% Exploration
    const finalScore =
      affinityScore * 0.4 + qualityScore * 0.3 + freshnessScore * 0.2 + explorationScore * 0.1;

    return {
      ...video,
      _finalScore: finalScore,
    };
  });

  // Sort descending by final score
  scored.sort((a, b) => b._finalScore - a._finalScore);

  const selected = scored.slice(offset, offset + actualLimit);

  // Enrich with creator profile, tags, and like/save status
  const enriched = await enrichVideoRecords(selected, userId);

  // Record impressions
  if (userId) {
    recordImpressions(
      userId,
      enriched.map((v) => v.id)
    );
  }

  return enforceFeedDiversity(enriched);
}

/**
 * Enriches video items with creator details from sensitive_userdata,
 * video tags, and whether the current user liked or saved the video.
 */
export async function enrichVideoRecords(
  videos: any[],
  userId?: string | null
): Promise<SparkVideoRecord[]> {
  if (videos.length === 0) return [];

  const videoIds = videos.map((v) => v.id);
  const creatorIds = Array.from(new Set(videos.map((v) => v.creator_id)));

  // Batch queries
  const [creatorsRes, tagsRes, userLikesRes, userSavesRes] = await Promise.all([
    supabaseAdmin
      .from('sensitive_userdata')
      .select('id, username, name, avatarurl, is_bluetick, is_redtick')
      .in('id', creatorIds),
    supabaseAdmin.from('sparks_video_tags').select('video_id, tag').in('video_id', videoIds),
    userId
      ? supabaseAdmin
          .from('sparks_video_likes')
          .select('video_id')
          .eq('user_id', userId)
          .in('video_id', videoIds)
      : Promise.resolve({ data: [] }),
    userId
      ? supabaseAdmin
          .from('sparks_video_saves')
          .select('video_id')
          .eq('user_id', userId)
          .in('video_id', videoIds)
      : Promise.resolve({ data: [] }),
  ]);

  const creatorMap = new Map<string, any>();
  creatorsRes.data?.forEach((c) => creatorMap.set(c.id, c));

  const tagsMap = new Map<string, string[]>();
  tagsRes.data?.forEach((t) => {
    const list = tagsMap.get(t.video_id) || [];
    list.push(t.tag);
    tagsMap.set(t.video_id, list);
  });

  const likedSet = new Set<string>();
  userLikesRes.data?.forEach((l) => likedSet.add(l.video_id));

  const savedSet = new Set<string>();
  userSavesRes.data?.forEach((s) => savedSet.add(s.video_id));

  return videos.map((v) => ({
    id: v.id,
    creator_id: v.creator_id,
    video_url: v.video_url,
    thumbnail_url: v.thumbnail_url,
    caption: v.caption,
    duration_ms: v.duration_ms ?? 0,
    category: v.category,
    audio_id: v.audio_id,
    visibility: v.visibility,
    status: v.status,
    moderation_status: v.moderation_status,
    view_count: v.view_count ?? 0,
    like_count: v.like_count ?? 0,
    comment_count: v.comment_count ?? 0,
    share_count: v.share_count ?? 0,
    save_count: v.save_count ?? 0,
    created_at: v.created_at,
    updated_at: v.updated_at,
    creator: creatorMap.get(v.creator_id) || null,
    tags: tagsMap.get(v.id) || [],
    is_liked: likedSet.has(v.id) || v.is_liked === true,
    is_saved: savedSet.has(v.id) || v.is_saved === true,
  }));
}

/**
 * Diversity & Anti-Fatigue Filter:
 * Ensures users do not see two consecutive videos from the same creator.
 */
function enforceFeedDiversity(videos: SparkVideoRecord[]): SparkVideoRecord[] {
  if (videos.length <= 2) return videos;

  const result: SparkVideoRecord[] = [];
  const deferred: SparkVideoRecord[] = [];

  for (const video of videos) {
    const prev = result[result.length - 1];
    if (prev && prev.creator_id === video.creator_id) {
      // Defer same-creator video to avoid back-to-back repetition
      deferred.push(video);
    } else {
      result.push(video);
      // Try to re-inject deferred item if creator differs
      if (deferred.length > 0) {
        const nextDeferredIdx = deferred.findIndex((d) => d.creator_id !== video.creator_id);
        if (nextDeferredIdx !== -1) {
          result.push(deferred.splice(nextDeferredIdx, 1)[0]);
        }
      }
    }
  }

  return [...result, ...deferred];
}
