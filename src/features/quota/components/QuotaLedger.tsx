/**
 * Ledger view: one dense row per credential, grouped under a provider heading.
 *
 * Identity on the left (mono filename + plan line), meters in fixed-width
 * columns in the middle, actions on the right, hairline separators between
 * rows. Meters come from `describeCredential`, the same model the summary
 * cards aggregate, so a row's percentage is exactly what its card summed.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import type { CodexQuotaState, ResolvedTheme } from '@/types';
import {
  buildResetDisplay,
  formatInstantShort,
  parseIsoToMs,
  resolveQuotaErrorMessage,
} from '@/utils/quota';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { useNow } from '@/hooks/useNow';
import { getTypeLabel } from '@/features/authFiles/constants';
import { QUOTA_ADAPTERS, type QuotaCardState } from '../providers';
import { isQuotaRefreshDisabled, type QuotaFileEntry, type QuotaLedgerGroup } from '../logic';
import { useClaudeResetGrants } from '../providers/claude/ClaudeResetGrants';
import { describeCredential, type CredentialDescription, type CredentialMeter } from '../summary';
import { QuotaMeter } from './QuotaMeter';
import { quotaPageClasses } from './quotaClasses';
import cardStyles from './QuotaCard.module.scss';
import styles from './QuotaLedger.module.scss';

export type QuotaLedgerProps = {
  groups: QuotaLedgerGroup[];
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined;
  displayNameFor: (entry: QuotaFileEntry) => string;
  resolvedTheme: ResolvedTheme;
  canUseActions: boolean;
  resettingQuotaName: string | null;
  onRefresh: (entry: QuotaFileEntry) => void;
  onReset: (entry: QuotaFileEntry) => void;
};

const planTierClass = (tier: CredentialDescription['planTier']) =>
  tier === 'elite'
    ? quotaPageClasses.elitePlanValue
    : tier === 'premium'
      ? quotaPageClasses.premiumPlanValue
      : styles.plan;

function MeterCell({
  meter,
  index,
  now,
  locale,
  t,
}: {
  meter: CredentialMeter;
  index: number;
  now: number;
  locale?: string;
  t: TFunction;
}) {
  const reset = buildResetDisplay(meter.resetLabel, meter.resetAtMs, now, locale);
  return (
    <div className={styles.meter}>
      <div className={styles.meterHead}>
        <span className={styles.meterLabel}>{meter.label}</span>
        <span className={styles.meterPercent}>
          {meter.remaining === null ? '--' : `${meter.remaining}%`}
        </span>
      </div>
      <QuotaMeter percent={meter.remaining} classes={quotaPageClasses} index={index} />
      <div className={styles.meterReset}>
        {reset ? (
          <>
            {reset.relative && <span className={styles.meterResetRelative}>{reset.relative}</span>}
            {reset.relative && (
              <span className={styles.meterResetDot} aria-hidden="true">
                ·
              </span>
            )}
            <span>{reset.absolute}</span>
          </>
        ) : (
          <span>{t('quota_management.ledger_no_reset')}</span>
        )}
      </div>
    </div>
  );
}

function CodexResetsCell({
  quota,
  now,
  locale,
  t,
}: {
  quota: CodexQuotaState;
  now: number;
  locale?: string;
  t: TFunction;
}) {
  const available = quota.rateLimitResetCreditsAvailableCount ?? null;
  const credits = quota.rateLimitResetCredits ?? [];
  if (available === null && credits.length === 0) return null;
  return (
    <div className={styles.meter}>
      <div className={styles.meterHead}>
        <span className={styles.meterLabel}>{t('codex_quota.reset_credits_label')}</span>
      </div>
      {available !== null && (
        <div className={styles.resetsAvailable}>
          <span className={styles.resetsCount}>{available}</span>
          <span>{t('quota_management.ledger_resets_available')}</span>
        </div>
      )}
      {credits.map((credit, index) => {
        const expiresAtMs = parseIsoToMs(credit.expiresAt);
        const display = buildResetDisplay(
          expiresAtMs === null ? credit.expiresAt : formatInstantShort(expiresAtMs),
          expiresAtMs,
          now,
          locale
        );
        return (
          <div key={credit.id || `${credit.expiresAt}-${index}`} className={styles.meterReset}>
            <span className={styles.resetsLabel}>
              {t('codex_quota.reset_credit_number', { index: index + 1 })}
            </span>
            {display?.relative && (
              <>
                <span className={styles.meterResetDot} aria-hidden="true">
                  ·
                </span>
                <span className={styles.meterResetRelative}>{display.relative}</span>
              </>
            )}
            {display && (
              <>
                <span className={styles.meterResetDot} aria-hidden="true">
                  ·
                </span>
                <span className={styles.resetsAbsolute}>{display.absolute}</span>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

type QuotaLedgerRowProps = {
  entry: QuotaFileEntry;
  displayName: string;
  quota?: QuotaCardState;
  canRefresh: boolean;
  resetting: boolean;
  onRefresh: () => void;
  onReset: () => void;
};

function QuotaLedgerRow(props: QuotaLedgerRowProps) {
  const { entry, displayName, quota, canRefresh, resetting, onRefresh, onReset } = props;
  const { t, i18n } = useTranslation();
  const now = useNow();
  const locale = i18n.resolvedLanguage;
  const adapter = QUOTA_ADAPTERS[entry.type];
  const status = quota?.status ?? 'idle';
  const loading = status === 'loading';

  const claudeReset = useClaudeResetGrants(
    entry.file,
    entry.type === 'claude' && status !== 'idle',
    !canRefresh || loading || resetting,
    quota,
    onRefresh
  );

  const description = useMemo(
    () => describeCredential(entry.type, quota, t),
    [entry.type, quota, t]
  );
  // Headline column first (matches the summary card), the rest in payload order.
  const orderedMeters = useMemo(() => {
    const headline = description.meters[description.primaryIndex];
    if (!headline) return description.meters;
    return [headline, ...description.meters.filter((meter) => meter !== headline)];
  }, [description]);
  const renewal = description.renewal
    ? buildResetDisplay(description.renewal.label, description.renewal.atMs, now, locale)
    : null;

  const errorMessage = resolveQuotaErrorMessage(
    t,
    quota?.errorStatus,
    quota?.error || t('common.unknown_error')
  );
  const showReset =
    status === 'success' &&
    Boolean(adapter.resetQuota) &&
    quota !== undefined &&
    Boolean(adapter.canResetQuota?.(quota));

  return (
    <div className={styles.row}>
      <div className={styles.identity}>
        <span className={styles.fileName} title={displayName}>
          {displayName}
        </span>
        {(description.planLabel || renewal) && (
          <span className={styles.planLine}>
            {description.planLabel && (
              <span className={planTierClass(description.planTier)}>{description.planLabel}</span>
            )}
            {renewal && (
              <>
                {description.planLabel && (
                  <span className={styles.planDot} aria-hidden="true">
                    ·
                  </span>
                )}
                <span className={styles.planMeta}>
                  {t('quota_management.ledger_renews', { date: renewal.absolute })}
                </span>
                {renewal.relative && (
                  <>
                    <span className={styles.planDot} aria-hidden="true">
                      ·
                    </span>
                    <span className={styles.planMeta}>{renewal.relative}</span>
                  </>
                )}
              </>
            )}
          </span>
        )}
      </div>

      <div className={styles.meters}>
        {status === 'idle' ? (
          <button type="button" className={styles.idle} onClick={onRefresh} disabled={!canRefresh}>
            <IconRefreshCw size={14} aria-hidden="true" />
            <span>{t(`${adapter.i18nPrefix}.idle`)}</span>
          </button>
        ) : loading ? (
          <div className={styles.skeleton} aria-busy="true">
            <span className={cardStyles.srOnly}>{t(`${adapter.i18nPrefix}.loading`)}</span>
            {[0, 1, 2].map((column) => (
              <div key={column} className={cardStyles.skeletonRow} aria-hidden="true">
                <span className={cardStyles.skeletonLabel} />
                <span className={cardStyles.skeletonTrack} />
              </div>
            ))}
          </div>
        ) : status === 'error' ? (
          <div className={cardStyles.errorStrip} role="alert">
            {t(`${adapter.i18nPrefix}.load_failed`, { message: errorMessage })}
          </div>
        ) : description.meters.length === 0 ? (
          <div className={styles.empty}>{t('quota_management.ledger_no_meters')}</div>
        ) : (
          <>
            {orderedMeters.map((meter, index) => (
              <MeterCell
                key={meter.id}
                meter={meter}
                index={index}
                now={now}
                locale={locale}
                t={t}
              />
            ))}
            {entry.type === 'codex' && quota && (
              <CodexResetsCell quota={quota as CodexQuotaState} now={now} locale={locale} t={t} />
            )}
          </>
        )}
        {entry.type === 'claude' && claudeReset.message && (
          <div role="status" className={quotaPageClasses.codexResetCreditsError}>
            {t(`claude_reset.${claudeReset.message}`)}
          </div>
        )}
      </div>

      <div className={styles.actions}>
        {status !== 'idle' && (
          <>
            {entry.type === 'claude' && (
              <button
                type="button"
                className={styles.action}
                disabled={claudeReset.blocked}
                onClick={claudeReset.confirm}
                title={t(`claude_reset.${claudeReset.buttonLabel}`)}
              >
                <IconRefreshCw
                  size={13}
                  className={claudeReset.busy ? cardStyles.spinning : undefined}
                />
                {t(`claude_reset.${claudeReset.buttonLabel}`)}
              </button>
            )}
            {showReset && (
              <button
                type="button"
                className={styles.action}
                onClick={onReset}
                disabled={!canRefresh || loading || resetting}
                title={t('codex_quota.reset_button')}
              >
                <IconRefreshCw size={13} className={resetting ? cardStyles.spinning : undefined} />
                {t('codex_quota.reset_button')}
              </button>
            )}
            <button
              type="button"
              className={styles.action}
              onClick={onRefresh}
              disabled={isQuotaRefreshDisabled(canRefresh, loading, resetting || claudeReset.busy)}
              title={t('auth_files.quota_refresh_hint')}
            >
              <IconRefreshCw size={13} className={loading ? cardStyles.spinning : undefined} />
              {t('auth_files.quota_refresh_single')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function QuotaLedger(props: QuotaLedgerProps) {
  const {
    groups,
    quotaFor,
    displayNameFor,
    canUseActions,
    resettingQuotaName,
    onRefresh,
    onReset,
  } = props;
  const { t } = useTranslation();

  return (
    <div className={styles.ledger}>
      {groups.map((group) => (
        <section key={group.provider ?? 'all'} className={styles.group}>
          {group.provider && (
            <h2 className={styles.groupTitle}>
              <span>{getTypeLabel(t, group.provider)}</span>
              <span className={styles.groupCount}>{group.entries.length}</span>
            </h2>
          )}
          <div className={styles.rows}>
            {group.entries.map((entry) => {
              const key = getQuotaCacheKey(entry.file);
              return (
                <QuotaLedgerRow
                  key={`${entry.type}:${key}`}
                  entry={entry}
                  displayName={displayNameFor(entry)}
                  quota={quotaFor(entry)}
                  canRefresh={canUseActions && !entry.file.disabled}
                  resetting={resettingQuotaName === key}
                  onRefresh={() => onRefresh(entry)}
                  onReset={() => onReset(entry)}
                />
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
