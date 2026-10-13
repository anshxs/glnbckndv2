import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth';
import { jsonSuccess, jsonError, jsonUnauthorized } from '@/lib/api-response';

/**
 * GET /api/sparks/user/interests
 * Fetch the authenticated user's learned interest weights.
 */
export async function GET(req: NextRequest) {
  let authUser;
  try {
    authUser = await requireAuth(req);
  } catch {
    return jsonUnauthorized();
  }

  const { data: interests, error } = await supabaseAdmin
    .from('sparks_user_interests')
    .select('interest, weight, updated_at')
    .eq('user_id', authUser.id)
    .order('weight', { ascending: false });

  if (error) {
    return jsonError('Failed to fetch interests.', 500, error.message);
  }

  return jsonSuccess({ interests: interests || [] });
}

/**
 * PUT /api/sparks/user/interests
 * Initialize or bulk-set user interests (e.g. during onboarding topics selection).
 * Body: { interests: Array<{ interest: string, weight?: number }> | string[] }
 */
export async function PUT(req: NextRequest) {
  let authUser;
  try {
    authUser = await requireAuth(req);
  } catch {
    return jsonUnauthorized();
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON request body.');
  }

  const rawList = Array.isArray(body.interests) ? body.interests : [];
  if (rawList.length === 0) {
    return jsonError('interests array is required.');
  }

  const rows = rawList
    .map((item: any) => {
      const interest = typeof item === 'string' ? item : item?.interest;
      const weight = typeof item === 'object' && typeof item?.weight === 'number' ? item.weight : 0.8;
      if (!interest || typeof interest !== 'string') return null;
      return {
        user_id: authUser.id,
        interest: interest.trim().toLowerCase().slice(0, 50),
        weight: Math.max(0.0, Math.min(1.0, weight)),
        updated_at: new Date().toISOString(),
      };
    })
    .filter(Boolean);

  const { error } = await supabaseAdmin
    .from('sparks_user_interests')
    .upsert(rows, { onConflict: 'user_id,interest' });

  if (error) {
    return jsonError('Failed to update interests.', 500, error.message);
  }

  return jsonSuccess({ message: 'Interests updated successfully.', count: rows.length });
}
