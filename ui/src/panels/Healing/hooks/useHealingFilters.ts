import { useMemo } from 'react';
import type { HealingRecordView } from '@core/ui/contracts.js';

export type StatusFilter = 'all' | 'proposed' | 'watching' | 'applied' | 'rejected';
export type PlatformFilter = 'all' | 'web' | 'android' | 'ios';

export const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Tất cả' },
  { value: 'proposed', label: 'Chờ duyệt' },
  { value: 'watching', label: 'Đang theo dõi' },
  { value: 'applied', label: 'Đã áp dụng' },
  { value: 'rejected', label: 'Đã từ chối' },
];

export const PLATFORM_OPTIONS: { value: PlatformFilter; label: string }[] = [
  { value: 'all', label: 'Tất cả' },
  { value: 'web', label: 'Web' },
  { value: 'android', label: 'Android' },
  { value: 'ios', label: 'iOS' },
];

/** Đúng biểu thức lọc của app.js:1108 — hai bộ lọc AND với nhau. */
export function useFilteredRecords(
  records: HealingRecordView[] | undefined,
  status: StatusFilter,
  platform: PlatformFilter,
): HealingRecordView[] {
  return useMemo(
    () =>
      (records ?? []).filter(
        (r) =>
          (status === 'all' || r.status === status) &&
          (platform === 'all' || r.platform === platform),
      ),
    [records, status, platform],
  );
}
