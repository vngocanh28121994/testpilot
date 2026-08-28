import { useEffect, useRef, type CSSProperties, type RefObject } from 'react';
import { cn } from '@/lib/utils';

/**
 * Nền động dạng chấm — cổng từ sen/frontend
 * (src/components/login/depth-neural-background.tsx).
 *
 * Ba khác biệt so với bản của sen, đều có lý do:
 *
 * 1. Màu đường nối lấy từ token `--primary` (đọc qua canvas 1x1 để quy về RGB)
 *    thay vì hardcode indigo. Brand TestPilot là xanh lá; nếu bê nguyên số của
 *    sen thì các chấm xanh lá lại nối với nhau bằng dây xanh tím.
 * 2. Vòng vẽ dừng khi tab ẩn, và với `prefers-reduced-motion` thì chỉ vẽ một
 *    lần rồi thôi — không có gì chuyển động thì không cần rAF.
 * 3. Nhận `className` để chỗ dùng tự quyết định absolute hay fixed. AppShell
 *    dùng `fixed` để các chấm đứng yên khi nội dung cuộn.
 */

type ParticleSpec = {
  left: string;
  top: string;
  size: number;
  opacity: number;
  duration: number;
  delay: number;
  halo: number;
};

type LinkSpec = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  opacity: number;
};

type ClusterSpec = {
  left: string;
  top: string;
  size: number;
  opacity: number;
  duration: number;
  delay: number;
};

const BACK_PARTICLES: ParticleSpec[] = [
  { left: '12%', top: '18%', size: 4, opacity: 0.2, duration: 7, delay: -2, halo: 28 },
  { left: '19%', top: '32%', size: 5, opacity: 0.28, duration: 8, delay: -7, halo: 34 },
  { left: '28%', top: '14%', size: 6, opacity: 0.22, duration: 9, delay: -10, halo: 42 },
  { left: '34%', top: '41%', size: 4, opacity: 0.18, duration: 7.5, delay: -4, halo: 24 },
  { left: '44%', top: '23%', size: 5, opacity: 0.3, duration: 8.5, delay: -12, halo: 30 },
  { left: '55%', top: '12%', size: 4, opacity: 0.18, duration: 9.5, delay: -9, halo: 20 },
  { left: '61%', top: '36%', size: 5, opacity: 0.22, duration: 8, delay: -5, halo: 28 },
  { left: '72%', top: '20%', size: 6, opacity: 0.24, duration: 10, delay: -8, halo: 36 },
  { left: '78%', top: '44%', size: 4, opacity: 0.2, duration: 7.5, delay: -3, halo: 22 },
  { left: '86%', top: '27%', size: 5, opacity: 0.26, duration: 8.5, delay: -11, halo: 26 },
  { left: '70%', top: '68%', size: 5, opacity: 0.2, duration: 9, delay: -6, halo: 28 },
  { left: '82%', top: '78%', size: 4, opacity: 0.16, duration: 8, delay: -13, halo: 18 },
  { left: '7%', top: '44%', size: 4, opacity: 0.18, duration: 8, delay: -3, halo: 22 },
  { left: '16%', top: '72%', size: 5, opacity: 0.22, duration: 9, delay: -8, halo: 28 },
  { left: '24%', top: '55%', size: 4, opacity: 0.2, duration: 7.5, delay: -11, halo: 20 },
  { left: '38%', top: '28%', size: 5, opacity: 0.26, duration: 8.5, delay: -5, halo: 30 },
  { left: '48%', top: '8%', size: 4, opacity: 0.18, duration: 9, delay: -2, halo: 18 },
  { left: '52%', top: '48%', size: 6, opacity: 0.24, duration: 7, delay: -9, halo: 38 },
  { left: '65%', top: '14%', size: 4, opacity: 0.2, duration: 8, delay: -6, halo: 22 },
  { left: '67%', top: '52%', size: 5, opacity: 0.22, duration: 9.5, delay: -4, halo: 26 },
  { left: '76%', top: '32%', size: 4, opacity: 0.18, duration: 8.5, delay: -12, halo: 20 },
  { left: '90%', top: '58%', size: 5, opacity: 0.2, duration: 7.5, delay: -7, halo: 24 },
  { left: '42%', top: '78%', size: 4, opacity: 0.16, duration: 8, delay: -10, halo: 18 },
  { left: '58%', top: '82%', size: 5, opacity: 0.18, duration: 9, delay: -1, halo: 22 },
];

const FRONT_PARTICLES: ParticleSpec[] = [
  { left: '14%', top: '58%', size: 7, opacity: 0.55, duration: 6, delay: -4, halo: 56 },
  { left: '22%', top: '63%', size: 5, opacity: 0.38, duration: 6.5, delay: -8, halo: 30 },
  { left: '27%', top: '52%', size: 6, opacity: 0.44, duration: 5.5, delay: -6, halo: 40 },
  { left: '36%', top: '61%', size: 8, opacity: 0.62, duration: 7, delay: -2, halo: 64 },
  { left: '46%', top: '54%', size: 5, opacity: 0.34, duration: 6, delay: -10, halo: 24 },
  { left: '58%', top: '66%', size: 7, opacity: 0.5, duration: 6.5, delay: -7, halo: 52 },
  { left: '64%', top: '57%', size: 5, opacity: 0.36, duration: 7.5, delay: -5, halo: 26 },
  { left: '73%', top: '64%', size: 8, opacity: 0.6, duration: 6, delay: -11, halo: 60 },
  { left: '82%', top: '60%', size: 6, opacity: 0.42, duration: 7, delay: -9, halo: 34 },
  { left: '88%', top: '70%', size: 7, opacity: 0.48, duration: 6.5, delay: -3, halo: 46 },
  { left: '9%', top: '48%', size: 5, opacity: 0.36, duration: 6, delay: -5, halo: 28 },
  { left: '18%', top: '74%', size: 6, opacity: 0.44, duration: 7, delay: -9, halo: 40 },
  { left: '32%', top: '44%', size: 5, opacity: 0.38, duration: 5.5, delay: -3, halo: 30 },
  { left: '41%', top: '72%', size: 7, opacity: 0.52, duration: 6.5, delay: -12, halo: 52 },
  { left: '50%', top: '44%', size: 5, opacity: 0.34, duration: 7, delay: -7, halo: 24 },
  { left: '54%', top: '76%', size: 6, opacity: 0.46, duration: 6, delay: -4, halo: 42 },
  { left: '69%', top: '74%', size: 7, opacity: 0.5, duration: 7.5, delay: -10, halo: 50 },
  { left: '77%', top: '48%', size: 5, opacity: 0.38, duration: 6.5, delay: -6, halo: 28 },
  { left: '85%', top: '80%', size: 6, opacity: 0.44, duration: 6, delay: -2, halo: 36 },
  { left: '93%', top: '56%', size: 5, opacity: 0.36, duration: 7, delay: -8, halo: 26 },
];

const LINKS: LinkSpec[] = [
  { x1: 14, y1: 58, x2: 22, y2: 63, opacity: 0.2 },
  { x1: 22, y1: 63, x2: 27, y2: 52, opacity: 0.16 },
  { x1: 27, y1: 52, x2: 36, y2: 61, opacity: 0.22 },
  { x1: 36, y1: 61, x2: 46, y2: 54, opacity: 0.14 },
  { x1: 46, y1: 54, x2: 58, y2: 66, opacity: 0.18 },
  { x1: 58, y1: 66, x2: 64, y2: 57, opacity: 0.15 },
  { x1: 64, y1: 57, x2: 73, y2: 64, opacity: 0.2 },
  { x1: 73, y1: 64, x2: 82, y2: 60, opacity: 0.16 },
  { x1: 82, y1: 60, x2: 88, y2: 70, opacity: 0.18 },
  { x1: 58, y1: 66, x2: 73, y2: 64, opacity: 0.12 },
  { x1: 9, y1: 48, x2: 18, y2: 74, opacity: 0.15 },
  { x1: 32, y1: 44, x2: 41, y2: 72, opacity: 0.18 },
  { x1: 41, y1: 72, x2: 54, y2: 76, opacity: 0.14 },
  { x1: 50, y1: 44, x2: 54, y2: 76, opacity: 0.16 },
  { x1: 69, y1: 74, x2: 77, y2: 48, opacity: 0.15 },
  { x1: 85, y1: 80, x2: 93, y2: 56, opacity: 0.17 },
];

const CLUSTERS: ClusterSpec[] = [
  { left: '33%', top: '59%', size: 220, opacity: 0.75, duration: 8, delay: -4 },
  { left: '73%', top: '63%', size: 180, opacity: 0.68, duration: 9, delay: -9 },
];

// Dựng sẵn: "left%,top%" → chỉ số phần tử trong DOM (back trước, front sau).
const ALL_PARTICLES_DATA = [...BACK_PARTICLES, ...FRONT_PARTICLES];
const posIndex = new Map<string, number>();
ALL_PARTICLES_DATA.forEach((p, i) => {
  posIndex.set(`${parseFloat(p.left)},${parseFloat(p.top)}`, i);
});

type LinkPair = { i1: number; i2: number; opacity: number };
const LINK_PAIRS: LinkPair[] = LINKS.map(({ x1, y1, x2, y2, opacity }) => ({
  i1: posIndex.get(`${x1},${y1}`) ?? -1,
  i2: posIndex.get(`${x2},${y2}`) ?? -1,
  opacity,
})).filter((p): p is LinkPair => p.i1 >= 0 && p.i2 >= 0);

const DRIFT_VARIANTS = [
  'dot-field-drift-a',
  'dot-field-drift-b',
  'dot-field-drift-c',
  'dot-field-drift-d',
  'dot-field-drift-e',
  'dot-field-drift-f',
  'dot-field-drift-g',
  'dot-field-drift-h',
] as const;

/** Xanh lá brand, dùng khi không đọc được `--primary` (trình duyệt cũ, jsdom). */
const FALLBACK_RGB: [number, number, number] = [45, 138, 86];

const rgbCache = new Map<string, [number, number, number]>();

/**
 * `--primary` là oklch(), còn gradient của canvas cần rgba() để chèn alpha.
 * Cách rẻ nhất để đổi hệ màu mà không kéo thư viện: tô một canvas 1x1 rồi đọc
 * pixel — chính trình duyệt làm việc quy đổi.
 */
function resolvePrimaryRgb(): [number, number, number] {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
  if (!raw) return FALLBACK_RGB;

  const cached = rgbCache.get(raw);
  if (cached) return cached;

  let rgb = FALLBACK_RGB;
  try {
    const probe = document.createElement('canvas');
    probe.width = 1;
    probe.height = 1;
    const pctx = probe.getContext('2d', { willReadFrequently: true });
    if (pctx) {
      // fillStyle giữ nguyên giá trị cũ nếu chuỗi màu không hợp lệ — đặt sentinel
      // trước để phân biệt "không parse được" với "màu thật sự là đen".
      pctx.fillStyle = '#000000';
      pctx.fillStyle = raw;
      if (pctx.fillStyle !== '#000000') {
        pctx.fillRect(0, 0, 1, 1);
        const d = pctx.getImageData(0, 0, 1, 1).data;
        rgb = [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0];
      }
    }
  } catch {
    // getImageData có thể ném trong môi trường test — cứ dùng fallback.
  }

  rgbCache.set(raw, rgb);
  return rgb;
}

function particleStyle(particle: ParticleSpec, index: number): CSSProperties {
  return {
    left: particle.left,
    top: particle.top,
    width: particle.size,
    height: particle.size,
    opacity: particle.opacity,
    animationName: DRIFT_VARIANTS[index % DRIFT_VARIANTS.length],
    animationDuration: `${particle.duration}s`,
    animationDelay: `${particle.delay}s`,
    ['--particle-halo' as string]: `${particle.halo}px`,
  };
}

function clusterStyle(cluster: ClusterSpec): CSSProperties {
  return {
    left: cluster.left,
    top: cluster.top,
    width: cluster.size,
    height: cluster.size,
    opacity: cluster.opacity,
    animationDuration: `${cluster.duration}s`,
    animationDelay: `${cluster.delay}s`,
  };
}

function useDotFieldCanvas(
  containerRef: RefObject<HTMLDivElement | null>,
  { disableMouseLinks = false }: { disableMouseLinks?: boolean } = {},
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: -9999, y: -9999 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const withMouse = !disableMouseLinks && !reduceMotion;

    let canvasRect = canvas.getBoundingClientRect();
    let color = resolvePrimaryRgb();

    // Theme đổi ⇒ `--primary` đổi ⇒ màu dây nối phải đổi theo. Đọc lại ở đây
    // (một lần mỗi lần đổi class) rẻ hơn nhiều so với getComputedStyle mỗi frame.
    const themeObserver = new MutationObserver(() => {
      color = resolvePrimaryRgb();
      if (reduceMotion) draw();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'data-color-theme'],
    });

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      canvasRect = canvas.getBoundingClientRect();
      if (reduceMotion) draw();
    };

    const onMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX - canvasRect.left, y: e.clientY - canvasRect.top };
    };
    const onLeave = () => {
      mouseRef.current = { x: -9999, y: -9999 };
    };

    const MAX_DIST = 220;

    let cachedParticles: HTMLElement[] | null = null;
    const getParticles = (): HTMLElement[] => {
      if (!cachedParticles) {
        const found = containerRef.current
          ? Array.from(containerRef.current.querySelectorAll<HTMLElement>('.dot-field__particle'))
          : [];
        if (found.length > 0) cachedParticles = found;
        return found;
      }
      return cachedParticles;
    };

    let rafId = 0;

    function draw() {
      if (!canvas || !ctx) return;
      const w = canvas.width;
      const h = canvas.height;
      const { x: mx, y: my } = mouseRef.current;
      ctx.clearRect(0, 0, w, h);

      const [r, g, b] = color;
      const particles = getParticles();

      // Đọc hết getBoundingClientRect trước, ghi canvas sau — tránh layout thrashing.
      const rects = particles.map((el) => el.getBoundingClientRect());

      // --- Dây nối cố định, bám theo chấm theo thời gian thực ---
      ctx.save();
      for (const { i1, i2, opacity } of LINK_PAIRS) {
        const r1 = rects[i1];
        const r2 = rects[i2];
        if (!r1 || !r2) continue;

        const p1x = r1.left + r1.width / 2 - canvasRect.left;
        const p1y = r1.top + r1.height / 2 - canvasRect.top;
        const p2x = r2.left + r2.width / 2 - canvasRect.left;
        const p2y = r2.top + r2.height / 2 - canvasRect.top;

        const grad = ctx.createLinearGradient(p1x, p1y, p2x, p2y);
        grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
        grad.addColorStop(0.5, `rgba(${r},${g},${b},${opacity})`);
        grad.addColorStop(1, `rgba(${r},${g},${b},0)`);

        ctx.beginPath();
        ctx.moveTo(p1x, p1y);
        ctx.lineTo(p2x, p2y);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1;
        ctx.shadowBlur = 10;
        ctx.shadowColor = `rgba(${r},${g},${b},${opacity * 0.5})`;
        ctx.stroke();
      }
      ctx.restore();

      // --- Dây nối theo con trỏ ---
      if (withMouse) {
        for (let i = 0; i < particles.length; i++) {
          const elRect = rects[i];
          if (!elRect) continue;
          const px = elRect.left + elRect.width / 2 - canvasRect.left;
          const py = elRect.top + elRect.height / 2 - canvasRect.top;
          const dist = Math.hypot(mx - px, my - py);

          if (dist < MAX_DIST) {
            const t = 1 - dist / MAX_DIST;
            const alpha = t * t * 0.75;

            const grad = ctx.createLinearGradient(mx, my, px, py);
            grad.addColorStop(0, `rgba(${r},${g},${b},${alpha * 0.4})`);
            grad.addColorStop(1, `rgba(${r},${g},${b},${alpha})`);

            ctx.save();
            ctx.beginPath();
            ctx.moveTo(mx, my);
            ctx.lineTo(px, py);
            ctx.strokeStyle = grad;
            ctx.lineWidth = 1.5;
            ctx.shadowBlur = 14;
            ctx.shadowColor = `rgba(${r},${g},${b},${alpha * 0.55})`;
            ctx.stroke();
            ctx.restore();
          }
        }

        // --- Quầng sáng quanh con trỏ ---
        if (mx > 0 && my > 0 && mx < w && my < h) {
          const glow = ctx.createRadialGradient(mx, my, 0, mx, my, 18);
          glow.addColorStop(0, `rgba(${r},${g},${b},0.35)`);
          glow.addColorStop(1, `rgba(${r},${g},${b},0)`);
          ctx.beginPath();
          ctx.arc(mx, my, 18, 0, Math.PI * 2);
          ctx.fillStyle = glow;
          ctx.fill();
        }
      }
    }

    const loop = () => {
      draw();
      rafId = requestAnimationFrame(loop);
    };

    const start = () => {
      if (reduceMotion || rafId) return;
      rafId = requestAnimationFrame(loop);
    };
    const stop = () => {
      if (!rafId) return;
      cancelAnimationFrame(rafId);
      rafId = 0;
    };

    // Tab ẩn thì rAF cũng bị ga hoặc dừng, nhưng dừng hẳn cho chắc: mỗi frame
    // là 44 lần đọc layout, không đáng trả khi không ai nhìn.
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVisibility);

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    if (withMouse) {
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseleave', onLeave);
    }

    resize();
    if (reduceMotion) draw();
    else start();

    return () => {
      stop();
      ro.disconnect();
      themeObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseleave', onLeave);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return canvasRef;
}

interface DotBackgroundProps {
  /** Tắt dây nối theo con trỏ và quầng sáng quanh con trỏ. */
  disableMouseLinks?: boolean;
  /** Ghi đè lớp định vị; mặc định phủ kín phần tử cha đã `relative`. */
  className?: string;
}

export function DotBackground({ disableMouseLinks = false, className }: DotBackgroundProps = {}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useDotFieldCanvas(containerRef, { disableMouseLinks });

  return (
    <div
      ref={containerRef}
      aria-hidden
      className={cn('dot-field pointer-events-none absolute inset-0 overflow-hidden', className)}
    >
      <div className="dot-field__wash" />
      <div className="dot-field__grid" />
      <div className="dot-field__beam" />

      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      <div className="absolute inset-0">
        {CLUSTERS.map((cluster, index) => (
          <span
            key={`cluster-${index}`}
            className="dot-field__cluster"
            style={clusterStyle(cluster)}
          />
        ))}
      </div>

      <div className="absolute inset-0 blur-[1px]">
        {BACK_PARTICLES.map((particle, index) => (
          <span
            key={`back-${index}`}
            className="dot-field__particle dot-field__particle--back"
            style={particleStyle(particle, index)}
          />
        ))}
      </div>

      <div className="absolute inset-0">
        {FRONT_PARTICLES.map((particle, index) => (
          <span
            key={`front-${index}`}
            className="dot-field__particle dot-field__particle--front"
            style={particleStyle(particle, index + BACK_PARTICLES.length)}
          />
        ))}
      </div>
    </div>
  );
}
