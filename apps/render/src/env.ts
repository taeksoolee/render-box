export type Env = {
  DB: D1Database;
  APP_ORIGIN: string;
  RENDER_ORIGIN: string;
  HANDOFF_SECRET: string;
  DEV_MODE?: string;
};

export const isDev = (env: Env) => env.DEV_MODE === "1";
