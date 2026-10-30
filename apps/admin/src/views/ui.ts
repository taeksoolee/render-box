// Tailwind class sets from docs/ui.md §5. JS never builds class strings; it
// only toggles data-*/aria-* attributes that these classes react to.
const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

export const btn =
  "inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-md text-sm font-medium whitespace-nowrap " +
  `transition-colors ${focus} disabled:opacity-50 disabled:cursor-not-allowed ` +
  "aria-disabled:opacity-50 aria-disabled:pointer-events-none";
export const primary = `${btn} bg-primary text-white hover:bg-primary-hover`;
export const secondary = `${btn} border border-line-input bg-surface text-fg hover:bg-canvas`;
export const danger = `${btn} border border-danger-line bg-surface text-danger-fg hover:bg-danger-soft`;
export const ghost = `${btn} px-3 text-fg-muted hover:bg-canvas hover:text-fg`;
export const iconBtn = `inline-flex size-10 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-canvas hover:text-fg ${focus}`;
export const spinner = "size-4 animate-spin motion-reduce:animate-none";

export const label = "mb-1.5 block text-sm font-medium text-fg";
export const input =
  "block w-full h-10 rounded-md border border-line-input bg-surface px-3 text-base sm:text-sm text-fg " +
  "placeholder:text-fg-subtle focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus " +
  "focus-visible:border-focus aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:outline-danger";
export const textarea = input.replace("h-10", "min-h-24 py-2 leading-6 resize-y");
export const codeArea = `${textarea} font-mono text-xs leading-5 h-64`;
export const hint = "mt-1.5 text-xs text-fg-subtle";
export const fieldErr = "mt-1.5 flex items-start gap-1 text-xs text-danger-fg";

export const segWrap = "inline-flex rounded-md border border-line-input p-0.5 bg-surface";
export const segItem =
  "has-[:checked]:bg-primary-soft has-[:checked]:text-info-fg has-[:focus-visible]:outline-2 " +
  "has-[:focus-visible]:outline-focus rounded px-3 h-8 inline-flex items-center text-sm text-fg-muted cursor-pointer";

const badge = "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium";
export const badgeNeutral = `${badge} border border-line bg-canvas text-fg-muted`;
export const badgePrimary = `${badge} bg-primary-soft text-info-fg`;
export const badgeWarning = `${badge} bg-warning-soft text-warning-fg border border-warning-line`;

export const tableWrap = "overflow-hidden rounded-lg border border-line bg-surface";
export const th = "bg-canvas px-4 py-2.5 text-left text-xs font-medium text-fg-muted whitespace-nowrap";
export const thNum = `${th} text-right`;
export const tr = "relative border-t border-line hover:bg-canvas";
export const td = "px-4 py-3 align-top";
export const tdNum = `${td} text-right tabular-nums text-fg-muted whitespace-nowrap`;
export const rowTitle =
  "font-medium text-fg break-keep after:absolute after:inset-0 focus-visible:outline-none " +
  "focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus";
export const rowDesc = "mt-0.5 truncate text-xs text-fg-subtle";
export const rowAction =
  "relative z-10 inline-flex items-center gap-1 rounded-md px-2 h-8 text-sm text-primary hover:bg-primary-soft whitespace-nowrap " +
  "focus-visible:outline-2 focus-visible:outline-focus";

const alert = "flex gap-3 rounded-lg border p-4 text-sm";
export const alertStyles = {
  success: { box: `${alert} border-success-line bg-success-soft`, title: "font-semibold text-success-fg", icon: "text-success-fg" },
  info: { box: `${alert} border-primary-line bg-primary-soft`, title: "font-semibold text-info-fg", icon: "text-info-fg" },
  warning: { box: `${alert} border-warning-line bg-warning-soft`, title: "font-semibold text-warning-fg", icon: "text-warning-fg" },
  error: { box: `${alert} border-danger-line bg-danger-soft`, title: "font-semibold text-danger-fg", icon: "text-danger-fg" },
} as const;
export const safetyLine = "flex items-center gap-2 text-xs text-fg-subtle";

export const empty = "rounded-lg border border-dashed border-line-input bg-surface px-6 py-12 text-center";
export const card = "rounded-lg border border-line bg-surface p-4 sm:p-6";
export const h2 = "text-base font-semibold text-fg";
export const backLink = "inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg";
