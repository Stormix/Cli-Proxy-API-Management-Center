import { useEffect, useRef } from 'react';
import { useQuotaStore } from '@/stores/useQuotaStore';
import type { QuotaFileEntry } from '../logic';

/** Background refresh cadence while the page is open and visible. */
export const QUOTA_AUTO_REFRESH_MS = 5 * 60 * 1000;

/** Loads quota for every visible credential once per visit (no click-to-load),
 * then re-polls the visible page every QUOTA_AUTO_REFRESH_MS while the tab is visible.
 */
export function useQuotaAutoLoad(
  entries: QuotaFileEntry[],
  disabled: boolean,
  loadQuota: (targets: QuotaFileEntry[]) => Promise<void>
) {
  const attempted = useRef(new Set<string>());
  const session = useQuotaStore((state) => state.cacheGeneration);
  const fileGenerations = useQuotaStore((state) => state.fileGenerations);

  useEffect(() => {
    if (disabled) return;
    const targets = entries.filter(({ file }) => {
      const key = JSON.stringify([
        session,
        fileGenerations[file.name] ?? 0,
        file.name,
        file.authIndex,
      ]);
      if (attempted.current.has(key)) return false;
      attempted.current.add(key);
      return true;
    });
    if (targets.length > 0) void loadQuota(targets);
  }, [disabled, entries, fileGenerations, loadQuota, session]);

  const latest = useRef({ entries, disabled, loadQuota });
  useEffect(() => {
    latest.current = { entries, disabled, loadQuota };
  }, [entries, disabled, loadQuota]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const { entries: current, disabled: isDisabled, loadQuota: load } = latest.current;
      if (isDisabled || document.visibilityState !== 'visible' || current.length === 0) return;
      void load(current);
    }, QUOTA_AUTO_REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);
}
