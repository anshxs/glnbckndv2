import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://uihvridcuqcacpkoopru.supabase.co';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseServiceRoleKey) {
  console.warn('[Supabase Warning] SUPABASE_SERVICE_ROLE_KEY is not defined. Server API routes requiring service role will fail.');
}

/**
 * Supabase Admin Client
 * Uses SUPABASE_SERVICE_ROLE_KEY to bypass Row Level Security.
 * All mutations and reads from the backend API must use this client.
 */
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
