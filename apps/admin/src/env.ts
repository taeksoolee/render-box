import type { SessionUser } from "@render-box/auth";

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_ORIGIN: string;
  RENDER_ORIGIN: string;
  HANDOFF_SECRET: string;
  STORAGE_LIMIT_MB?: string;
  STORAGE_WARN_PERCENT?: string;
  HELP_URL?: string;
  DEFAULT_PROJECT?: string;
  DEV_MODE?: string;
};

export type AppEnv = {
  Bindings: Env;
  Variables: { user: SessionUser | null };
};

export const isDev = (env: Env) => env.DEV_MODE === "1";
