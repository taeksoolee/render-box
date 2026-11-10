export type Env = {
  DB: D1Database;
  APP_ORIGIN: string;
  RENDER_ORIGIN: string;
  API_ORIGIN: string;
  STORAGE_LIMIT_MB?: string;
  STORAGE_WARN_PERCENT?: string;
  DEV_MODE?: string;
};
