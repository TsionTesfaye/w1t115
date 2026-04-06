export const AUTH_CONSTANTS = {
  PBKDF2_ITERATIONS: 100000,
  SALT_LENGTH: 16,
  HASH_LENGTH: 32,
  MAX_FAILED_ATTEMPTS: 5,
  CAPTCHA_THRESHOLD: 3,
  LOCKOUT_DURATION_MINUTES: 15,
  SESSION_TIMEOUT_MINUTES: 30,
  REMEMBER_SESSION_DAYS: 7,
  CAPTCHA_EXPIRY_SECONDS: 120,
} as const;

export const DOCUMENT_CONSTANTS = {
  MAX_FILE_SIZE_BYTES: 25 * 1024 * 1024,
  MAX_ACCOUNT_STORAGE_BYTES: 200 * 1024 * 1024,
  ALLOWED_MIME_TYPES: ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'] as readonly string[],
  ALLOWED_EXTENSIONS: ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp'] as readonly string[],
  MIME_EXTENSION_MAP: new Map<string, string[]>([
    ['application/pdf', ['.pdf']],
    ['image/png', ['.png']],
    ['image/jpeg', ['.jpg', '.jpeg']],
    ['image/gif', ['.gif']],
    ['image/webp', ['.webp']],
  ]),
} as const;

export const NOTIFICATION_CONSTANTS = {
  MAX_INSTANT_PER_TYPE_PER_DAY: 3,
  DIGEST_HOUR: 8,
} as const;

export const MODERATION_CONSTANTS = {
  MAX_LINKS_PER_COMMENT: 3,
  COOLDOWN_SECONDS: 30,
} as const;

export const INTEGRATION_CONSTANTS = {
  RATE_LIMIT_PER_MINUTE: 60,
  IDEMPOTENCY_KEY_TTL_HOURS: 24,
  MAX_WEBHOOK_RETRIES: 5,
  MAX_WEBHOOK_RETRY_WINDOW_MINUTES: 15,
  HMAC_ALGORITHM: 'SHA-256',
  ROTATION_GRACE_WINDOW_MINUTES: 5,
} as const;

export const SCHEDULER_CONSTANTS = {
  INTERVAL_MS: 60000,           // how often the leader runs scheduled tasks
  LEADER_HEARTBEAT_MS: 5000,    // how often the leader updates the heartbeat timestamp
  LEADER_TIMEOUT_MS: 15000,     // how long a follower waits before assuming the leader is dead
  ELECTION_GRACE_MS: 80,        // grace window after writing a claim before verifying it won
  ELECTION_JITTER_MAX_MS: 200,  // max random delay before attempting to claim leadership
  LEADER_KEY: 'tb_scheduler_leader',
  LEADER_HEARTBEAT_KEY: 'tb_scheduler_heartbeat',
} as const;

export const CONTENT_CONSTANTS = {
  PIN_DURATION_DAYS: 7,
} as const;

export const STORAGE_CONSTANTS = {
  PRESSURE_THRESHOLD: 0.8,
  DB_NAME: 'TalentBridgeDB',
  DB_VERSION: 1,
} as const;

export const BROADCAST_CHANNELS = {
  SESSION: 'tb_session_sync',
  DATA: 'tb_data_sync',
  NOTIFICATIONS: 'tb_notification_sync',
  SCHEDULER: 'tb_scheduler_sync',   // leader election + heartbeat signaling
} as const;
