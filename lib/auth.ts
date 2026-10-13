import { supabaseAdmin } from './supabase';

export interface AuthenticatedUser {
  id: string;
  email?: string;
  role?: string;
}

/**
 * Extracts and verifies Bearer token from the HTTP Authorization header.
 * Uses Supabase Auth to validate the JWT and fetch the user identity.
 */
export async function getAuthenticatedUser(req: Request): Promise<AuthenticatedUser | null> {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    return null;
  }

  try {
    const {
      data: { user },
      error,
    } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
    };
  } catch (err) {
    console.error('[Auth Error] Error verifying Supabase token:', err);
    return null;
  }
}

/**
 * Helper to require authentication. Returns user or throws a typed response error.
 */
export async function requireAuth(req: Request): Promise<AuthenticatedUser> {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    throw new Error('UNAUTHORIZED');
  }
  return user;
}
