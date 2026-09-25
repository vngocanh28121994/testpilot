import type { TouchMark } from '@/hooks/useTouchMarks';

/** Vẽ dấu chạm — xem [useTouchMarks](../../hooks/useTouchMarks.ts). */
export function TouchMarks({ marks }: { marks: Array<TouchMark & { id: number }> }) {
  if (marks.length === 0) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-md">
      <svg className="absolute inset-0 h-full w-full">
        {marks.filter((mark) => mark.kind === 'swipe').map((mark) => mark.kind === 'swipe' && (
          <line
            key={mark.id}
            data-testid="touch-trail"
            className="touch-trail"
            x1={mark.x}
            y1={mark.y}
            x2={mark.toX}
            y2={mark.toY}
            stroke="var(--primary)"
            strokeWidth={6}
            strokeLinecap="round"
          />
        ))}
      </svg>
      {marks.map((mark) => {
        const at = mark.kind === 'swipe' ? { x: mark.toX, y: mark.toY } : mark;
        return (
          <span
            key={mark.id}
            data-testid="touch-mark"
            className="touch-mark border-primary bg-primary/25 absolute size-8 rounded-full border-2"
            style={{ left: at.x, top: at.y }}
          />
        );
      })}
    </div>
  );
}
