export type SparksVisibility = 'public' | 'private' | 'followers_only';
export type SparksStatus = 'active' | 'processing' | 'deleted' | 'disabled';
export type SparksModerationStatus = 'pending' | 'approved' | 'rejected';

/**
 * Strict Create Video Request Payload
 * ONLY these fields are allowed from the client.
 * All metrics (view_count, like_count, etc.) are strictly forbidden and system-controlled.
 */
export interface CreateSparkVideoInput {
  video_url: string;
  thumbnail_url?: string | null;
  caption?: string | null;
  category?: string | null;
  audio_id?: string | null;
  visibility?: SparksVisibility;
  tags?: string[]; // Optional explicit tags or extracted from caption #hashtags
}

export interface UpdateSparkVideoInput {
  thumbnail_url?: string | null;
  caption?: string | null;
  category?: string | null;
  visibility?: SparksVisibility;
}

export interface SparkVideoRecord {
  id: string;
  creator_id: string;
  video_url: string;
  thumbnail_url: string | null;
  caption: string | null;
  duration_ms: number;
  category: string | null;
  audio_id: string | null;
  visibility: SparksVisibility;
  status: SparksStatus;
  moderation_status: SparksModerationStatus;
  view_count: number;
  like_count: number;
  comment_count: number;
  share_count: number;
  save_count: number;
  created_at: string;
  updated_at: string;
  creator?: {
    id: string;
    username: string | null;
    name: string | null;
    avatarurl: string | null;
    is_bluetick?: boolean;
    is_redtick?: boolean;
  } | null;
  tags?: string[];
  is_liked?: boolean;
  is_saved?: boolean;
}

export interface RecordViewInput {
  video_id: string;
  watched_ms: number;
  rewatched_ms?: number;
  completed?: boolean;
  source?: 'feed' | 'profile' | 'share' | 'search' | 'trending';
}

export interface RecordShareInput {
  video_id: string;
  share_type: 'internal_share' | 'copy_link' | 'whatsapp' | 'instagram' | 'telegram' | 'system_share' | 'dm';
}

export interface RecordFeedEventInput {
  video_id: string;
  event_type: 'skip' | 'not_interested' | 'pause' | 'resume' | 'loop' | 'dwell' | 'profile_click';
  watch_ms?: number;
  metadata?: Record<string, any>;
}

export interface CreateCommentInput {
  content?: string | null;
  gif_url?: string | null;
  parent_comment_id?: string | null;
}
