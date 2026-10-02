import { describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import type { ClaudeQuotaState, CodexQuotaState } from '@/types';
import { describeCredential, meterLevel, summarizeProvider } from '@/features/quota/summary';
import { groupLedgerEntries, type QuotaFileEntry } from '@/features/quota/logic';

const t = ((key: string) => key) as unknown as TFunction;
const NOW = Date.UTC(2026, 8, 11, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

const claude = (fableUsed: number, weekUsed: number, resetInDays: number): ClaudeQuotaState => ({
  status: 'success',
  planType: 'plan_max',
  windows: [
    {
      id: 'five-hour',
      label: '5-hour limit',
      labelKey: 'claude_quota.five_hour',
      usedPercent: 0,
      resetLabel: '-',
      resetAtMs: null,
      periodHours: 5,
    },
    {
      id: 'seven-day',
      label: '7-day limit',
      labelKey: 'claude_quota.seven_day',
      usedPercent: weekUsed,
      resetLabel: '-',
      resetAtMs: NOW + resetInDays * DAY,
      periodHours: 168,
    },
    {
      id: 'seven-day-fable',
      label: '7-day Fable 5',
      labelKey: 'claude_quota.seven_day_fable',
      usedPercent: fableUsed,
      resetLabel: '-',
      resetAtMs: NOW + resetInDays * DAY,
      periodHours: 168,
    },
  ],
});

describe('provider summary aggregate', () => {
  test('sums the remaining % each row prints (screenshot: 409% of 500%, 454%)', () => {
    const states = [
      claude(42, 21, 2),
      claude(0, 0, 4),
      claude(0, 0, 5),
      claude(49, 25, 1),
      claude(0, 0, 6),
    ];
    const descriptions = states.map((state) => describeCredential('claude', state, t));
    const summary = summarizeProvider('claude', descriptions, NOW, t);

    expect(summary.count).toBe(5);
    expect(summary.primaryLabel).toBe('claude_quota.seven_day_fable');
    expect(summary.primarySum).toBe(409);
    expect(summary.primarySegments.map((segment) => segment.remaining)).toEqual([
      58, 100, 100, 51, 100,
    ]);
    expect(summary.secondaryLabel).toBe('claude_quota.seven_day');
    expect(summary.secondarySum).toBe(454);
    expect(summary.nextResetMs).toBe(NOW + DAY);
  });

  test('unloaded credentials contribute nothing and render as "--"', () => {
    const summary = summarizeProvider(
      'codex',
      [describeCredential('codex', undefined, t), describeCredential('codex', undefined, t)],
      NOW,
      t
    );
    expect(summary.primarySum).toBeNull();
    expect(summary.primaryLabel).toBe('codex_quota.secondary_window');
    expect(summary.primarySegments).toEqual([{ remaining: null }, { remaining: null }]);
  });

  test('counts errored credentials as needing attention', () => {
    const summary = summarizeProvider(
      'claude',
      [describeCredential('claude', { status: 'error', error: 'x' }, t)],
      NOW,
      t
    );
    expect(summary.attentionCount).toBe(1);
  });

  test('ignores resets that already elapsed', () => {
    const summary = summarizeProvider(
      'claude',
      [describeCredential('claude', claude(10, 10, -1), t)],
      NOW,
      t
    );
    expect(summary.nextResetMs).toBeNull();
  });
});

describe('codex credential description', () => {
  test('headline is the weekly window and renewal comes from the subscription', () => {
    const state: CodexQuotaState = {
      status: 'success',
      planType: 'pro',
      subscriptionActiveUntil: '2026-10-03T17:02:00Z',
      windows: [
        {
          id: 'five-hour',
          label: '5-hour limit',
          usedPercent: 10,
          resetLabel: '-',
          resetAtMs: null,
        },
        { id: 'weekly', label: 'Weekly limit', usedPercent: 83, resetLabel: '-', resetAtMs: null },
      ],
    };
    const description = describeCredential('codex', state, t);
    expect(description.meters[description.primaryIndex].remaining).toBe(17);
    expect(description.planLabel).toBe('codex_quota.plan_pro');
    expect(description.planTier).toBe('elite');
    expect(description.renewal?.atMs).toBe(Date.parse('2026-10-03T17:02:00Z'));
  });
});

describe('meter level', () => {
  test('uses the QuotaMeter thresholds', () => {
    expect(meterLevel(70)).toBe('high');
    expect(meterLevel(69)).toBe('medium');
    expect(meterLevel(30)).toBe('medium');
    expect(meterLevel(29)).toBe('low');
    expect(meterLevel(null)).toBe('unknown');
  });
});

describe('ledger grouping', () => {
  const entry = (name: string, type: QuotaFileEntry['type']): QuotaFileEntry => ({
    file: { name } as QuotaFileEntry['file'],
    type,
  });

  test('groups by provider in incoming order, or returns one flat group', () => {
    const entries = [entry('a', 'claude'), entry('b', 'codex'), entry('c', 'claude')];
    expect(
      groupLedgerEntries(entries, true).map((group) => [
        group.provider,
        group.entries.map((item) => item.file.name),
      ])
    ).toEqual([
      ['claude', ['a', 'c']],
      ['codex', ['b']],
    ]);
    expect(groupLedgerEntries(entries, false)).toEqual([{ provider: null, entries }]);
    expect(groupLedgerEntries([], false)).toEqual([]);
  });
});
