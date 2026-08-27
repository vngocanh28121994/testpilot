import type { LocatorCandidate, LocatorQuality } from '@core/ui/contracts.js';

/** Cách app.js hiển thị một candidate: `strategy=value` (app.js:1152). */
export function formatLocator(candidate: LocatorCandidate | null | undefined): string {
  return candidate ? `${candidate.strategy}=${candidate.value}` : 'Chưa có locator';
}

export type QualityTone = 'stable' | 'review' | 'fragile';

/**
 * Ba mức của quality gate. Thứ tự kiểm quan trọng: `stable` thắng `promotable`,
 * giống hệt biểu thức lồng nhau ở app.js:1210.
 */
export function qualityTone(q: LocatorQuality): QualityTone {
  if (q.stable) return 'stable';
  return q.promotable ? 'review' : 'fragile';
}

export function qualityLabel(q: LocatorQuality): string {
  return { stable: 'Ổn định', review: 'Có thể duyệt', fragile: 'Fragile' }[qualityTone(q)];
}

const STATUS_LABELS: Record<string, string> = {
  proposed: 'Chờ duyệt',
  watching: 'Đang theo dõi',
  applied: 'Đã áp dụng',
  rejected: 'Đã từ chối',
};

/** app.js:1253 — trả về chính status nếu gặp giá trị lạ, không nuốt mất nó. */
export function healingStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/**
 * Số máy đã đóng góp bằng chứng, kèm phần chú giải.
 *
 * Bằng chứng được gộp qua nhiều máy một cách có chủ đích, nên con số này là
 * thứ DUY NHẤT phân biệt "ba máy đồng ý testId đã đổi" với "một trên ba máy
 * không đồng ý với hai máy kia" — hai tình huống trông giống hệt nhau ở cột
 * Heals và có ý nghĩa ngược nhau (app.js:1180).
 */
export function deviceTooltip(devices: Record<string, number>): string {
  const names = Object.keys(devices);
  return names.length
    ? names.map((n) => `${n}: ${devices[n]}`).join('\n')
    : 'Bằng chứng ghi trước khi có tách theo máy.';
}
