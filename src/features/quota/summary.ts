/**
 * One flat description of a credential's meters, shared by the summary cards
 * and the ledger rows.
 *
 * The provider bodies each compute "remaining %" in their own way (Claude and
 * Codex store percent used, Antigravity a remaining fraction, Kimi raw counts,
 * xAI a usage percent). This module mirrors those exact formulas — including
 * the rounding each body applies before printing — so that the number in a
 * summary card is literally the sum of the numbers printed on the rows.
 *
 * Pure and React-free: `t` is injected, and the quota state is read
 * structurally per provider.
 */

import type { TFunction } from 'i18next';
import type {
  AntigravityQuotaState,
  ClaudeQuotaState,
  CodexQuotaState,
  DevinQuotaState,
  KimiQuotaState,
  MetaQuotaState,
  XaiQuotaState,
} from '@/types';
import { formatKimiResetHint, parseIsoToMs, resolvePlanTier, resolveResetMs } from '@/utils/quota';
import {
  ANTIGRAVITY_BUCKET_LABEL_KEYS,
  getAntigravityPlanLabel,
  translateAntigravityQuotaLabel,
} from './providers/antigravity/labels';
import { resolveCodexPlanLabel } from './providers/codex/planLabel';
import { QUOTA_PROGRESS_HIGH_THRESHOLD, QUOTA_PROGRESS_MEDIUM_THRESHOLD } from './constants';
import type { QuotaCardState } from './providers';
import type { QuotaProviderType } from './providers/types';

export interface CredentialMeter {
  id: string;
  label: string;
  /** Remaining percent, rounded the way the row prints it; null when unknown. */
  remaining: number | null;
  resetAtMs: number | null;
  /** Provider-baked absolute label, when the instant cannot reproduce it. */
  resetLabel: string | null;
  periodHours: number | null;
}

export interface CredentialRenewal {
  atMs: number | null;
  /** Fallback when the payload is not a parseable instant. */
  label: string | null;
}

export interface CredentialDescription {
  status: QuotaCardState['status'];
  meters: CredentialMeter[];
  /** Index into `meters` of the headline window, or -1. */
  primaryIndex: number;
  /** Index into `meters` of the footer window, or -1. */
  secondaryIndex: number;
  planLabel: string | null;
  planTier: 'elite' | 'premium' | 'standard';
  /** Codex subscription renewal — the only provider that exposes one worth a line. */
  renewal: CredentialRenewal | null;
}

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

const usableMs = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Headline window per provider; the first id found wins. */
const PRIMARY_PREFERENCE: Partial<Record<QuotaProviderType, readonly string[]>> = {
  claude: ['seven-day-fable', 'seven-day', 'five-hour'],
  codex: ['weekly', 'monthly', 'five-hour'],
  devin: ['weekly', 'daily'],
  meta: ['weekly', 'window'],
};

/** Label shown on a summary card before anything has loaded. */
export const PROVIDER_PRIMARY_LABEL_KEY: Record<QuotaProviderType, string> = {
  claude: 'claude_quota.seven_day_fable',
  codex: 'codex_quota.secondary_window',
  antigravity: 'antigravity_quota.weekly_limit',
  xai: 'xai_quota.weekly_limit',
  kimi: 'kimi_quota.weekly_limit',
  devin: 'devin_quota.weekly',
  meta: 'meta_quota.weekly',
};

/**
 * Pick headline/footer meters. Providers with a preference list use it;
 * everyone else takes the longest window first (ties: soonest reset), which
 * is the same rule the timeline uses to anchor a lane.
 */
function pickPrimaryAndSecondary(
  provider: QuotaProviderType,
  meters: CredentialMeter[]
): { primaryIndex: number; secondaryIndex: number } {
  if (meters.length === 0) return { primaryIndex: -1, secondaryIndex: -1 };

  const preference = PRIMARY_PREFERENCE[provider];
  let order: number[];
  if (preference) {
    const preferred = preference
      .map((id) => meters.findIndex((meter) => meter.id === id))
      .filter((index) => index !== -1);
    const rest = meters.map((_, index) => index).filter((index) => !preferred.includes(index));
    order = [...preferred, ...rest];
  } else {
    order = meters
      .map((meter, index) => ({ meter, index }))
      .sort((a, b) => {
        const byPeriod = (b.meter.periodHours ?? 0) - (a.meter.periodHours ?? 0);
        if (byPeriod !== 0) return byPeriod;
        const aReset = a.meter.resetAtMs ?? Number.POSITIVE_INFINITY;
        const bReset = b.meter.resetAtMs ?? Number.POSITIVE_INFINITY;
        return aReset - bReset || a.index - b.index;
      })
      .map((entry) => entry.index);
  }

  return { primaryIndex: order[0] ?? -1, secondaryIndex: order[1] ?? -1 };
}

const EMPTY_DESCRIPTION = (status: QuotaCardState['status']): CredentialDescription => ({
  status,
  meters: [],
  primaryIndex: -1,
  secondaryIndex: -1,
  planLabel: null,
  planTier: 'standard',
  renewal: null,
});

/** Claude/Codex windows share a shape: percent used + baked reset label. */
const describeUsedWindows = (
  windows: readonly {
    id: string;
    label: string;
    labelKey?: string;
    labelParams?: Record<string, string | number>;
    usedPercent: number | null;
    resetLabel: string;
    resetAtMs?: number | null;
    periodHours?: number | null;
  }[],
  t: TFunction
): CredentialMeter[] =>
  windows.map((window) => ({
    id: window.id,
    label: window.labelKey ? t(window.labelKey, window.labelParams) : window.label,
    remaining:
      window.usedPercent === null
        ? null
        : Math.round(clampPercent(100 - clampPercent(window.usedPercent))),
    resetAtMs: usableMs(window.resetAtMs),
    resetLabel: window.resetLabel && window.resetLabel !== '-' ? window.resetLabel : null,
    periodHours: window.periodHours ?? null,
  }));

export function describeCredential(
  provider: QuotaProviderType,
  quota: QuotaCardState | undefined,
  t: TFunction
): CredentialDescription {
  const status = quota?.status ?? 'idle';
  if (!quota || status !== 'success') return EMPTY_DESCRIPTION(status);

  let meters: CredentialMeter[] = [];
  let planLabel: string | null = null;
  let planTier: CredentialDescription['planTier'] = 'standard';
  let renewal: CredentialRenewal | null = null;

  switch (provider) {
    case 'claude': {
      const state = quota as ClaudeQuotaState;
      meters = describeUsedWindows(state.windows ?? [], t);
      planLabel = state.planType ? t(`claude_quota.${state.planType}`) : null;
      break;
    }
    case 'codex': {
      const state = quota as CodexQuotaState;
      meters = describeUsedWindows(state.windows ?? [], t);
      planLabel = resolveCodexPlanLabel(state.planType, t);
      {
        const tier = resolvePlanTier(state.planType);
        planTier = tier === 'plain' ? 'standard' : tier;
      }
      const until = state.subscriptionActiveUntil ?? null;
      if (until !== null && until !== '') {
        const atMs = resolveResetMs([until]);
        renewal = { atMs, label: atMs === null ? String(until) : null };
      }
      break;
    }
    case 'antigravity': {
      const state = quota as AntigravityQuotaState;
      meters = (state.groups ?? [])
        .flatMap((group) => group.buckets ?? [])
        .map((bucket) => ({
          id: bucket.id,
          label: translateAntigravityQuotaLabel(bucket.label, ANTIGRAVITY_BUCKET_LABEL_KEYS, t),
          remaining: Math.round(clampPercent(bucket.remainingFraction * 100)),
          resetAtMs: usableMs(bucket.resetAtMs) ?? parseIsoToMs(bucket.resetTime),
          resetLabel: null,
          periodHours: bucket.periodHours ?? null,
        }));
      planLabel = getAntigravityPlanLabel(state.subscription, t);
      const plan = state.subscription?.plan?.toLowerCase() ?? '';
      planTier = plan === 'ultra' || plan === 'ultra-lite' ? 'premium' : 'standard';
      break;
    }
    case 'kimi': {
      const state = quota as KimiQuotaState;
      meters = (state.rows ?? []).map((row) => ({
        id: row.id,
        label: row.labelKey
          ? t(row.labelKey, (row.labelParams ?? {}) as Record<string, string | number>)
          : (row.label ?? ''),
        remaining:
          row.limit > 0
            ? clampPercent(Math.round(((row.limit - row.used) / row.limit) * 100))
            : row.used > 0
              ? 0
              : null,
        resetAtMs: usableMs(row.resetAtMs),
        resetLabel:
          row.resetAtMs == null && row.resetHint ? formatKimiResetHint(t, row.resetHint) : null,
        periodHours: row.periodHours ?? null,
      }));
      break;
    }
    case 'xai': {
      const state = quota as XaiQuotaState;
      const billing = state.billing;
      if (!billing || billing.mode === 'paid-health') {
        planLabel = billing?.planLabel ?? (billing ? t('xai_quota.plan_paid') : null);
        break;
      }
      planLabel = billing.planLabel ?? null;
      planTier = billing.planTier ?? 'standard';
      if (billing.periodType === 'weekly') {
        meters.push({
          id: 'xai:weekly',
          label: t('xai_quota.weekly_limit'),
          remaining:
            billing.usagePercent === null
              ? null
              : Math.round(clampPercent(100 - clampPercent(billing.usagePercent))),
          resetAtMs: usableMs(billing.resetAtMs),
          resetLabel: null,
          periodHours: billing.periodHours ?? 24 * 7,
        });
      }
      billing.productUsage.forEach((item) => {
        meters.push({
          id: `xai:product:${item.product}`,
          label: t('xai_quota.product_usage', { product: item.product }),
          remaining:
            item.usagePercent === null
              ? null
              : Math.round(clampPercent(100 - clampPercent(item.usagePercent))),
          resetAtMs: null,
          resetLabel: null,
          periodHours: null,
        });
      });
      const hasMonthly =
        billing.monthlyLimitCents !== null ||
        billing.usedCents !== null ||
        Boolean(billing.billingPeriodEnd);
      if (
        hasMonthly &&
        !(
          billing.periodType === 'weekly' &&
          billing.monthlyLimitCents === 0 &&
          billing.usedCents === 0
        )
      ) {
        meters.push({
          id: 'xai:monthly',
          label: t('xai_quota.monthly_credits'),
          remaining:
            billing.usedPercent === null
              ? null
              : Math.round(clampPercent(100 - clampPercent(billing.usedPercent))),
          resetAtMs: parseIsoToMs(billing.billingPeriodEnd),
          resetLabel: null,
          periodHours: null,
        });
      }
      break;
    }
    case 'devin': {
      const state = quota as DevinQuotaState;
      meters = (state.windows ?? []).map((window) => ({
        id: window.id,
        label: t(`devin_quota.${window.id}`),
        remaining:
          window.remainingPercent === null
            ? null
            : Math.round(clampPercent(window.remainingPercent)),
        resetAtMs: usableMs(window.resetAtMs),
        resetLabel: null,
        periodHours: window.periodHours,
      }));
      planLabel = state.plan ?? null;
      break;
    }
    case 'meta': {
      const state = quota as MetaQuotaState;
      meters = (state.data?.windows ?? []).map((window) => ({
        id: window.id,
        label:
          window.id === 'window' && window.durationMinutes
            ? t('meta_quota.window_duration', { minutes: window.durationMinutes })
            : t(`meta_quota.${window.id}`),
        remaining:
          typeof window.usedPercent === 'number' && Number.isFinite(window.usedPercent)
            ? Math.round(clampPercent(100 - window.usedPercent))
            : null,
        resetAtMs: typeof window.resetAt === 'number' ? window.resetAt * 1000 : null,
        resetLabel: null,
        periodHours:
          window.id === 'weekly'
            ? 24 * 7
            : window.durationMinutes
              ? window.durationMinutes / 60
              : null,
      }));
      planLabel = state.data?.planName ?? null;
      break;
    }
  }

  return {
    status,
    meters,
    ...pickPrimaryAndSecondary(provider, meters),
    planLabel,
    planTier,
    renewal,
  };
}

/* ------------------------------------------------------------- aggregate */

export interface ProviderSegment {
  /** Remaining percent for one credential, or null when not loaded. */
  remaining: number | null;
}

export interface ProviderSummary {
  provider: QuotaProviderType;
  count: number;
  loadedCount: number;
  attentionCount: number;
  primaryLabel: string;
  /** Sum of the rounded remaining % across loaded credentials; null when none loaded. */
  primarySum: number | null;
  primarySegments: ProviderSegment[];
  /** Soonest upcoming primary reset across credentials, or null. */
  nextResetMs: number | null;
  secondaryLabel: string | null;
  secondarySum: number | null;
  secondarySegments: ProviderSegment[];
}

const sumRemaining = (segments: ProviderSegment[]): number | null => {
  let total: number | null = null;
  for (const segment of segments) {
    if (segment.remaining === null) continue;
    total = (total ?? 0) + segment.remaining;
  }
  return total;
};

/**
 * Aggregate one provider's credentials. `nowMs` filters already-elapsed
 * resets out of the "next reset" pick so a stale window never wins.
 */
export function summarizeProvider(
  provider: QuotaProviderType,
  descriptions: readonly CredentialDescription[],
  nowMs: number,
  t: TFunction
): ProviderSummary {
  const primarySegments: ProviderSegment[] = [];
  const secondarySegments: ProviderSegment[] = [];
  let primaryLabel: string | null = null;
  let secondaryLabel: string | null = null;
  let nextResetMs: number | null = null;
  let loadedCount = 0;
  let attentionCount = 0;

  for (const description of descriptions) {
    if (description.status === 'success') loadedCount += 1;
    else if (description.status === 'error') attentionCount += 1;

    const primary = description.meters[description.primaryIndex];
    const secondary = description.meters[description.secondaryIndex];
    primarySegments.push({ remaining: primary?.remaining ?? null });
    secondarySegments.push({ remaining: secondary?.remaining ?? null });
    if (primary && primaryLabel === null) primaryLabel = primary.label;
    if (secondary && secondaryLabel === null) secondaryLabel = secondary.label;
    if (
      primary?.resetAtMs !== null &&
      primary?.resetAtMs !== undefined &&
      primary.resetAtMs > nowMs
    ) {
      if (nextResetMs === null || primary.resetAtMs < nextResetMs) nextResetMs = primary.resetAtMs;
    }
  }

  return {
    provider,
    count: descriptions.length,
    loadedCount,
    attentionCount,
    primaryLabel: primaryLabel ?? t(PROVIDER_PRIMARY_LABEL_KEY[provider]),
    primarySum: sumRemaining(primarySegments),
    primarySegments,
    nextResetMs,
    secondaryLabel,
    secondarySum: sumRemaining(secondarySegments),
    secondarySegments,
  };
}

export type MeterLevel = 'high' | 'medium' | 'low' | 'unknown';

/** Same three bands QuotaMeter paints, so segments and rows agree. */
export function meterLevel(remaining: number | null): MeterLevel {
  if (remaining === null) return 'unknown';
  if (remaining >= QUOTA_PROGRESS_HIGH_THRESHOLD) return 'high';
  if (remaining >= QUOTA_PROGRESS_MEDIUM_THRESHOLD) return 'medium';
  return 'low';
}
