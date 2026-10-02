/**
 * Per-provider summary strip above the list.
 *
 * Each card answers one question for a whole provider — "how much capacity is
 * left across every credential?" — as `X% of Y%` where Y is 100 × credentials
 * and X is the sum of what each row prints. The segmented bar underneath is
 * one segment per credential, painted with the same thresholds as the row
 * meters, so a yellow sliver here is the same yellow bar further down.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ResolvedTheme } from '@/types';
import { buildResetDisplay } from '@/utils/quota';
import { useNow } from '@/hooks/useNow';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import type { QuotaProviderType } from '../providers/types';
import { meterLevel, type ProviderSegment, type ProviderSummary } from '../summary';
import styles from './QuotaSummaryCards.module.scss';

export type QuotaSummaryCardsProps = {
  summaries: ProviderSummary[];
  resolvedTheme: ResolvedTheme;
};

const LEVEL_CLASS: Record<ReturnType<typeof meterLevel>, string> = {
  high: styles.fillHigh,
  medium: styles.fillMedium,
  low: styles.fillLow,
  unknown: styles.fillUnknown,
};

function SegmentedBar({ segments, label }: { segments: ProviderSegment[]; label: string }) {
  return (
    <div className={styles.segments} role="img" aria-label={label}>
      {segments.map((segment, index) => (
        <span key={index} className={styles.segment}>
          <span
            className={`${styles.segmentFill} ${LEVEL_CLASS[meterLevel(segment.remaining)]}`}
            style={{ width: `${segment.remaining ?? 0}%` }}
          />
        </span>
      ))}
    </div>
  );
}

const formatSum = (sum: number | null) => (sum === null ? '--' : `${sum}%`);

export function QuotaSummaryCards({ summaries, resolvedTheme }: QuotaSummaryCardsProps) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const [expanded, setExpanded] = useState<Partial<Record<QuotaProviderType, boolean>>>({});

  if (summaries.length === 0) return null;

  return (
    <section className={styles.strip} aria-label={t('quota_management.summary_label')}>
      {summaries.map((summary) => {
        const provider = summary.provider;
        const typeLabel = getTypeLabel(t, provider);
        const iconSrc = getAuthFileIcon(provider, resolvedTheme);
        const total = summary.count * 100;
        const reset = buildResetDisplay(null, summary.nextResetMs, now, i18n.resolvedLanguage);
        const isExpanded = expanded[provider] === true;
        const hasSecondary = summary.secondaryLabel !== null;
        const hasFooter = hasSecondary || summary.attentionCount > 0;

        return (
          <article key={provider} className={styles.card}>
            <header className={styles.head}>
              <span
                className={styles.iconWrap}
                style={
                  isThemeSurfaceIconProvider(provider)
                    ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
                    : undefined
                }
              >
                {iconSrc ? (
                  <img src={iconSrc} alt="" className={styles.icon} />
                ) : (
                  <span className={styles.iconFallback}>{typeLabel.slice(0, 1).toUpperCase()}</span>
                )}
              </span>
              <span className={styles.name}>{typeLabel}</span>
              <span className={styles.count}>
                {summary.count === 1
                  ? t('quota_management.summary_credential_one', { count: summary.count })
                  : t('quota_management.summary_credentials', { count: summary.count })}
              </span>
            </header>

            <div className={styles.meterLabel}>{summary.primaryLabel}</div>
            <div className={styles.value}>
              <span className={summary.primarySum === null ? styles.valueMuted : styles.valueMain}>
                {formatSum(summary.primarySum)}
              </span>
              <span className={styles.valueTotal}>
                {t('quota_management.summary_of', { total })}
              </span>
            </div>
            <SegmentedBar
              segments={summary.primarySegments}
              label={`${summary.primaryLabel}: ${formatSum(summary.primarySum)} / ${total}%`}
            />
            <div className={styles.reset}>
              {reset ? (
                <>
                  {reset.relative && <span className={styles.resetRelative}>{reset.relative}</span>}
                  {reset.relative && (
                    <span className={styles.resetDot} aria-hidden="true">
                      ·
                    </span>
                  )}
                  <span className={styles.resetAbsolute}>{reset.absolute}</span>
                </>
              ) : (
                <span className={styles.resetMuted}>--</span>
              )}
            </div>

            {hasFooter && (
              <footer className={styles.footer}>
                <div className={styles.footerLeft}>
                  {hasSecondary && (
                    <span className={styles.secondary}>
                      <span className={styles.secondaryLabel}>{summary.secondaryLabel}</span>
                      <span className={styles.secondaryValue}>
                        {formatSum(summary.secondarySum)}
                      </span>
                    </span>
                  )}
                  {summary.attentionCount > 0 && (
                    <span className={styles.attention}>
                      {t('quota_management.meta_attention', { count: summary.attentionCount })}
                    </span>
                  )}
                </div>
                {hasSecondary && (
                  <button
                    type="button"
                    className={styles.toggle}
                    aria-expanded={isExpanded}
                    onClick={() =>
                      setExpanded((prev) => ({ ...prev, [provider]: !prev[provider] }))
                    }
                  >
                    {isExpanded
                      ? t('quota_management.summary_hide')
                      : t('quota_management.summary_show')}
                  </button>
                )}
              </footer>
            )}
            {hasSecondary && isExpanded && (
              <div className={styles.secondaryBar}>
                <SegmentedBar
                  segments={summary.secondarySegments}
                  label={`${summary.secondaryLabel}: ${formatSum(summary.secondarySum)} / ${total}%`}
                />
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
