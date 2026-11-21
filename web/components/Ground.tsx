'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, type ReactNode } from 'react';
import { A, B, RC, PITCH_A, PITCH_B, buildLayout, tifo, type Layout } from '@/lib/stadium';
import type { Kit } from '@/lib/clubs';

export type Emphasis = 'all' | 'real' | 'dust' | 'farmer' | 'contract';
export interface GroundHandle {
  flyTo(index: number): void;
  reset(): void;
  zoom(factor: number): void;
}
interface Props {
  total: number;
  realFans: number;
  ghosts: { dust: number; farmerOnly: number; contracts: number };
  kit: Kit;
  /** Per seat: 0 real, 1 dust, 2 farmer-only, 3 contract or pool. From the seat file when it has loaded. */
  kinds?: Uint8Array | null;
  focus?: number | null;
  pin?: ReactNode;
  emphasis?: Emphasis;
  interactive?: boolean;
  arrival?: boolean;
  onPick?: (index: number | null) => void;
  onZoomChange?: (zoomed: boolean) => void;
  label: string;
}

const MARIGOLD = '#FFC531';
const CHALK = '#F4F1E8';
const SKY = '#8AB8FF';

function hash01(i: number): number {
  let a = (i + 0x9e3779b9) | 0;
  a = Math.imul(a ^ (a >>> 16), 0x85ebca6b);
  a = Math.imul(a ^ (a >>> 13), 0xc2b2ae35);
  return ((a ^ (a >>> 16)) >>> 0) / 4294967296;
}

const Ground = forwardRef<GroundHandle, Props>(function Ground(props, ref) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pinRef = useRef<HTMLDivElement>(null);
  const P = useRef(props);
  P.current = props;

  const S = useRef({
    L: null as Layout | null,
    kind: new Uint8Array(0),
    tone: new Uint8Array(0),
    w: 0,
    h: 0,
    dpr: 1,
    portrait: false,
    cam: { x: 0, y: 0, z: 1 },
    reveal: 1,
    raf: 0,
    anim: 0,
    font: 'sans-serif',
    painted: false,
  });

  const api = useRef({
    draw: () => {},
    flyTo: (_i: number, _instant?: boolean) => {},
    reset: () => {},
    zoom: (_f: number) => {},
  });

  useImperativeHandle(ref, () => ({
    flyTo: (i) => api.current.flyTo(i),
    reset: () => api.current.reset(),
    zoom: (f) => api.current.zoom(f),
  }));

  // engine
  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext('2d', { alpha: true })!;
    const st = S.current;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    st.font = getComputedStyle(wrap).getPropertyValue('--font-display').trim() || 'sans-serif';

    const baseK = () => {
      const L = st.L!;
      const ew = st.portrait ? L.halfH : L.halfW;
      const eh = st.portrait ? L.halfW : L.halfH;
      return Math.min(st.w / (2 * ew), st.h / (2 * eh)) * 0.965;
    };
    const toScreen = (lx: number, ly: number) => {
      const k = baseK() * st.cam.z;
      const dx = lx - st.cam.x;
      const dy = ly - st.cam.y;
      return st.portrait ? { x: st.w / 2 - dy * k, y: st.h / 2 + dx * k } : { x: st.w / 2 + dx * k, y: st.h / 2 + dy * k };
    };
    const toLogical = (sx: number, sy: number) => {
      const k = baseK() * st.cam.z;
      const ux = (sx - st.w / 2) / k;
      const uy = (sy - st.h / 2) / k;
      return st.portrait ? { x: st.cam.x + uy, y: st.cam.y - ux } : { x: st.cam.x + ux, y: st.cam.y + uy };
    };

    function rrect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
      c.beginPath();
      c.moveTo(x + r, y);
      c.arcTo(x + w, y, x + w, y + h, r);
      c.arcTo(x + w, y + h, x, y + h, r);
      c.arcTo(x, y + h, x, y, r);
      c.arcTo(x, y, x + w, y, r);
      c.closePath();
    }

    // Static layer: bowl, pitch and every seat drawn as an empty seat. Valid for the whole-ground view.
    const base = document.createElement('canvas');
    const bctx = base.getContext('2d', { alpha: true })!;
    let baseKey = '';

    function world(c: CanvasRenderingContext2D, k: number) {
      c.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
      c.translate(st.w / 2, st.h / 2);
      c.scale(k, k);
      if (st.portrait) c.rotate(Math.PI / 2);
      c.translate(-st.cam.x, -st.cam.y);
    }

    function paintGround(c: CanvasRenderingContext2D, L: Layout, px: number) {
      const oW = L.halfW + 3;
      const oH = L.halfH + 3;
      rrect(c, -oW, -oH, oW * 2, oH * 2, RC + (oW - A));
      c.fillStyle = 'rgba(138,184,255,0.055)';
      c.fill();
      c.lineWidth = px;
      c.strokeStyle = 'rgba(138,184,255,0.22)';
      c.stroke();
      c.globalCompositeOperation = 'destination-out';
      rrect(c, -A - 3, -B - 3, (A + 3) * 2, (B + 3) * 2, RC);
      c.fillStyle = '#000';
      c.fill();
      c.globalCompositeOperation = 'source-over';
      // pitch: flat mowing stripes and hairline markings
      const stripes = 12;
      const sw = (PITCH_A * 2) / stripes;
      for (let i = 0; i < stripes; i++) {
        c.fillStyle = i % 2 ? 'rgba(18,168,116,0.2)' : 'rgba(18,168,116,0.145)';
        c.fillRect(-PITCH_A + i * sw, -PITCH_B, sw + px * 0.5, PITCH_B * 2);
      }
      c.strokeStyle = 'rgba(244,241,232,0.42)';
      c.lineWidth = Math.max(px, 1.1);
      c.strokeRect(-PITCH_A, -PITCH_B, PITCH_A * 2, PITCH_B * 2);
      c.beginPath();
      c.moveTo(0, -PITCH_B);
      c.lineTo(0, PITCH_B);
      c.moveTo(41, 0);
      c.arc(0, 0, 41, 0, Math.PI * 2);
      for (const sgn of [-1, 1]) {
        c.rect(sgn > 0 ? PITCH_A - 74 : -PITCH_A, -91, 74, 182);
        c.rect(sgn > 0 ? PITCH_A - 25 : -PITCH_A, -41, 25, 82);
      }
      c.stroke();
    }

    const GHOST = 'rgba(169,171,217,0.24)';

    function draw() {
      const L = st.L;
      if (!L || st.w < 10) return;
      const p = P.current;
      const { dpr } = st;
      const k = baseK() * st.cam.z;
      const px = 1 / k; // one css pixel in logical units
      const s = L.s;
      const detail = s * k >= 9;
      const q = Math.max(s * 0.66, 1.15 / (k * dpr));
      const h = q / 2;
      const emph = p.emphasis ?? 'all';
      const fans = Math.min(p.realFans, L.n);
      const lit = Math.floor(fans * st.reveal);
      const ghostHot = emph === 'dust' ? 1 : emph === 'farmer' ? 2 : emph === 'contract' ? 3 : 0;
      const whole = st.cam.z <= 1.001 && !detail;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (whole && !ghostHot) {
        const key = `${canvas.width}x${canvas.height}:${L.n}:${st.portrait}`;
        if (key !== baseKey) {
          base.width = canvas.width;
          base.height = canvas.height;
          world(bctx, k);
          paintGround(bctx, L, px);
          bctx.fillStyle = GHOST;
          for (let i = 0; i < L.n; i++) bctx.fillRect(L.x[i] - h, L.y[i] - h, q, q);
          baseKey = key;
        }
        ctx.drawImage(base, 0, 0);
        world(ctx, k);
      } else {
        world(ctx, k);
        paintGround(ctx, L, px);
      }

      // visible bounds in logical space
      const c0 = toLogical(0, 0);
      const c1 = toLogical(st.w, st.h);
      const minX = Math.min(c0.x, c1.x) - s;
      const maxX = Math.max(c0.x, c1.x) + s;
      const minY = Math.min(c0.y, c1.y) - s;
      const maxY = Math.max(c0.y, c1.y) + s;
      const cull = st.cam.z > 1.05;
      const vis = (i: number) => !cull || (L.x[i] >= minX && L.x[i] <= maxX && L.y[i] >= minY && L.y[i] <= maxY);
      const dim = emph !== 'all' && emph !== 'real';

      if (!detail) {
        if (!(whole && !ghostHot)) {
          ctx.fillStyle = GHOST;
          for (let i = 0; i < L.n; i++) {
            const kd = st.kind[i];
            if ((kd === 0 && i < lit) || (ghostHot && kd === ghostHot)) continue;
            if (vis(i)) ctx.fillRect(L.x[i] - h, L.y[i] - h, q, q);
          }
          if (ghostHot) {
            ctx.fillStyle = SKY;
            for (let i = fans; i < L.n; i++) if (st.kind[i] === ghostHot && vis(i)) ctx.fillRect(L.x[i] - h, L.y[i] - h, q, q);
          }
        }
        // fans: the tifo
        const qf = Math.max(s * 0.8, 1.7 / (k * dpr));
        const hf = qf / 2;
        ctx.globalAlpha = dim ? 0.3 : 1;
        for (let tone = 0; tone < 2; tone++) {
          ctx.fillStyle = tone ? p.kit.secondary : p.kit.primary;
          for (let i = 0; i < lit; i++) if (st.kind[i] === 0 && st.tone[i] === tone && vis(i)) ctx.fillRect(L.x[i] - hf, L.y[i] - hf, qf, qf);
        }
        ctx.globalAlpha = 1;
      } else {
        // close up: oriented seats with a backrest; empty seats are outlines
        const sw2 = s * 0.74;
        const sd = s * 0.6;
        ctx.lineWidth = px;
        for (let i = 0; i < L.n; i++) {
          if (!vis(i)) continue;
          const kd = st.kind[i];
          const isFan = kd === 0 && i < lit;
          ctx.save();
          ctx.translate(L.x[i], L.y[i]);
          ctx.rotate(L.ang[i] + Math.PI / 2);
          if (isFan) {
            ctx.fillStyle = st.tone[i] ? p.kit.secondary : p.kit.primary;
            ctx.globalAlpha = dim ? 0.3 : 1;
            ctx.fillRect(-sw2 / 2, -sd / 2, sw2, sd);
            ctx.fillRect(-sw2 / 2, -sd / 2 - s * 0.2, sw2, s * 0.12);
            ctx.globalAlpha = 1;
          } else if (ghostHot && kd === ghostHot) {
            ctx.fillStyle = SKY;
            ctx.fillRect(-sw2 / 2, -sd / 2, sw2, sd);
          } else {
            ctx.strokeStyle = 'rgba(169,171,217,0.42)';
            ctx.strokeRect(-sw2 / 2, -sd / 2, sw2, sd);
          }
          ctx.restore();
        }
      }

      // your seat
      const f = p.focus;
      let pinPt: { x: number; y: number } | null = null;
      if (f != null && f >= 0 && f < L.n) {
        const fs = Math.max(s * 0.9, 6 * px);
        ctx.save();
        ctx.translate(L.x[f], L.y[f]);
        ctx.rotate(L.ang[f] + Math.PI / 2);
        ctx.fillStyle = MARIGOLD;
        ctx.fillRect(-fs / 2, -fs / 2, fs, fs);
        ctx.restore();
        ctx.beginPath();
        ctx.arc(L.x[f], L.y[f], Math.max(s * 1.5, 11 * px), 0, Math.PI * 2);
        ctx.strokeStyle = MARIGOLD;
        ctx.lineWidth = 1.5 * px;
        ctx.stroke();
        pinPt = toScreen(L.x[f], L.y[f]);
      }

      // screen-space overlays
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (st.cam.z >= 2.4) {
        ctx.font = `600 13px ${st.font}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const b of L.blocks) {
          const pt = toScreen(b.x, b.y);
          if (pt.x < -30 || pt.x > st.w + 30 || pt.y < -20 || pt.y > st.h + 20) continue;
          const label = String(b.no);
          const tw = ctx.measureText(label).width + 12;
          ctx.fillStyle = 'rgba(18,16,55,0.86)';
          ctx.fillRect(pt.x - tw / 2, pt.y - 10, tw, 20);
          ctx.fillStyle = CHALK;
          ctx.fillText(label, pt.x, pt.y + 1);
        }
      }
      if (pinPt) {
        // the Banner T, dropped on the seat
        const u = 0.3;
        const ox = pinPt.x - 48 * u;
        const oy = pinPt.y - 16 - 96 * u;
        ctx.fillStyle = '#121037';
        ctx.fillRect(ox + 3 * u, oy + 3 * u, 90 * u, 90 * u);
        ctx.fillStyle = MARIGOLD;
        ctx.fillRect(ox + 9 * u, oy + 9 * u, 78 * u, 18 * u);
        ctx.beginPath();
        ctx.moveTo(ox + 27 * u, oy + 34 * u);
        ctx.lineTo(ox + 69 * u, oy + 34 * u);
        ctx.lineTo(ox + 69 * u, oy + 87 * u);
        ctx.lineTo(ox + 48 * u, oy + 69.4 * u);
        ctx.lineTo(ox + 27 * u, oy + 87 * u);
        ctx.closePath();
        ctx.fill();
      }
      const pin = pinRef.current;
      if (pin) {
        if (pinPt && st.anim === 0) {
          const below = pinPt.y < st.h * 0.42;
          const x = Math.max(8, Math.min(st.w - pin.offsetWidth - 8, pinPt.x - pin.offsetWidth / 2));
          const y = below ? pinPt.y + 22 : pinPt.y - pin.offsetHeight - 56;
          pin.style.transform = `translate(${Math.round(x)}px, ${Math.round(Math.max(8, Math.min(st.h - pin.offsetHeight - 8, y)))}px)`;
          pin.style.visibility = 'visible';
        } else {
          pin.style.visibility = 'hidden';
        }
      }
      if (!st.painted) {
        st.painted = true;
        (window as unknown as { __groundPaint?: number }).__groundPaint ??= performance.now();
        wrap.dataset.painted = '1';
      }
    }

    const schedule = () => {
      if (st.raf) return;
      st.raf = requestAnimationFrame(() => {
        st.raf = 0;
        draw();
      });
    };

    function clampCam() {
      const L = st.L!;
      st.cam.z = Math.max(1, Math.min(st.cam.z, 40));
      if (st.cam.z <= 1.001) {
        st.cam.x = 0;
        st.cam.y = 0;
      } else {
        st.cam.x = Math.max(-L.halfW, Math.min(L.halfW, st.cam.x));
        st.cam.y = Math.max(-L.halfH, Math.min(L.halfH, st.cam.y));
      }
      wrap.dataset.zoomed = st.cam.z > 1.02 ? '1' : '0';
    }

    function animateCam(to: { x: number; y: number; z: number }, ms: number) {
      cancelAnimationFrame(st.anim);
      st.anim = 0;
      const from = { ...st.cam };
      const done = () => {
        st.cam = { ...to };
        st.anim = 0;
        clampCam();
        P.current.onZoomChange?.(st.cam.z > 1.02);
        draw();
      };
      if (reduce || ms <= 0) return done();
      const t0 = performance.now();
      const lz0 = Math.log(from.z);
      const lz1 = Math.log(to.z);
      const far = Math.hypot(to.x - from.x, to.y - from.y) > 60 && from.z > 1.5;
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / ms);
        const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        const dip = far ? 1 - 0.45 * Math.sin(Math.PI * t) : 1;
        st.cam.z = Math.max(1, Math.exp(lz0 + (lz1 - lz0) * e) * dip);
        // travel early, settle late
        const m = 1 - Math.pow(1 - t, 3);
        st.cam.x = from.x + (to.x - from.x) * m;
        st.cam.y = from.y + (to.y - from.y) * m;
        draw();
        if (t < 1) st.anim = requestAnimationFrame(step);
        else done();
      };
      st.anim = requestAnimationFrame(step);
    }

    api.current.draw = schedule;
    api.current.flyTo = (i, instant) => {
      const L = st.L;
      if (!L || i < 0 || i >= L.n) return;
      const z = Math.max(3, Math.min(18 / (L.s * baseK()), 22));
      animateCam({ x: L.x[i], y: L.y[i], z }, instant ? 0 : 1800);
    };
    api.current.reset = () => animateCam({ x: 0, y: 0, z: 1 }, 700);
    api.current.zoom = (f) => {
      const z = Math.max(1, Math.min(st.cam.z * f, 28));
      animateCam({ x: z <= 1.001 ? 0 : st.cam.x, y: z <= 1.001 ? 0 : st.cam.y, z }, 320);
    };

    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      if (Math.abs(r.width - st.w) < 0.5 && Math.abs(r.height - st.h) < 0.5 && dpr === st.dpr) return;
      st.w = r.width;
      st.h = r.height;
      st.dpr = dpr;
      st.portrait = r.height > r.width * 1.05;
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      draw();
    });
    ro.observe(wrap);

    // zoom about a screen point, keeping the seat under the finger or cursor where it is
    let wasZoomed = false;
    const zoomAt = (sx: number, sy: number, z: number) => {
      cancelAnimationFrame(st.anim);
      st.anim = 0;
      const before = toLogical(sx, sy);
      st.cam.z = Math.max(1, Math.min(z, 28));
      const after = toLogical(sx, sy);
      st.cam.x += before.x - after.x;
      st.cam.y += before.y - after.y;
      clampCam();
      const zoomed = st.cam.z > 1.02;
      if (zoomed !== wasZoomed) {
        wasZoomed = zoomed;
        P.current.onZoomChange?.(zoomed);
      }
      schedule();
    };

    // pointer: pinch to zoom, drag to pan when zoomed, tap to pick a seat
    let down: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
    const pts = new Map<number, { x: number; y: number }>();
    let pinch: { d: number; z: number } | null = null;
    const local = (e: { clientX: number; clientY: number }) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onDown = (e: PointerEvent) => {
      if (!P.current.interactive) return;
      pts.set(e.pointerId, local(e));
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: st.cam.z };
        down = null;
        return;
      }
      down = { x: e.clientX, y: e.clientY, cx: st.cam.x, cy: st.cam.y, moved: false };
      if (st.cam.z > 1.02) canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (pts.has(e.pointerId)) pts.set(e.pointerId, local(e));
      if (pinch && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, pinch.z * (d / pinch.d));
        return;
      }
      if (!down || st.cam.z <= 1.02) return;
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      if (Math.abs(dx) + Math.abs(dy) > 5) down.moved = true;
      const k = baseK() * st.cam.z;
      if (st.portrait) {
        st.cam.x = down.cx - dy / k;
        st.cam.y = down.cy + dx / k;
      } else {
        st.cam.x = down.cx - dx / k;
        st.cam.y = down.cy - dy / k;
      }
      clampCam();
      schedule();
    };
    const onUp = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (pinch) {
        if (pts.size < 2) pinch = null;
        down = null;
        return;
      }
      const d = down;
      down = null;
      if (!d || d.moved || !P.current.interactive || !st.L) return;
      if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 8) return;
      const r = canvas.getBoundingClientRect();
      const pt = toLogical(e.clientX - r.left, e.clientY - r.top);
      const L = st.L;
      let best = -1;
      let bd = Infinity;
      for (let i = 0; i < L.n; i++) {
        const dd = (L.x[i] - pt.x) ** 2 + (L.y[i] - pt.y) ** 2;
        if (dd < bd) {
          bd = dd;
          best = i;
        }
      }
      const reach = Math.max(L.s, 14 / (baseK() * st.cam.z));
      P.current.onPick?.(best >= 0 && bd <= reach * reach ? best : null);
    };
    const onDbl = (e: MouseEvent) => {
      if (!P.current.interactive || !st.L) return;
      const r = canvas.getBoundingClientRect();
      const pt = toLogical(e.clientX - r.left, e.clientY - r.top);
      animateCam({ x: pt.x, y: pt.y, z: Math.min(st.cam.z * 2.2, 28) }, 380);
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    const onCancel = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      pinch = null;
      down = null;
    };
    // wheel: trackpad pinch (ctrl + wheel) always zooms; a plain wheel zooms only once zoomed in, so the page still scrolls
    const onWheel = (e: WheelEvent) => {
      if (!P.current.interactive) return;
      if (!(e.ctrlKey || e.metaKey) && st.cam.z <= 1.001) return;
      e.preventDefault();
      const p = local(e);
      zoomAt(p.x, p.y, st.cam.z * Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0022)));
    };
    canvas.addEventListener('pointercancel', onCancel);
    canvas.addEventListener('dblclick', onDbl);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      ro.disconnect();
      cancelAnimationFrame(st.raf);
      cancelAnimationFrame(st.anim);
      st.raf = 0;
      st.anim = 0;
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('dblclick', onDbl);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, []);

  // layout and seat kinds
  const { total, realFans, ghosts, kit, kinds, arrival } = props;
  useEffect(() => {
    const st = S.current;
    const L = buildLayout(total);
    st.L = L;
    const kind = new Uint8Array(L.n);
    const tone = new Uint8Array(L.n);
    const fans = Math.min(realFans, L.n);
    const gTotal = Math.max(1, ghosts.dust + ghosts.farmerOnly + ghosts.contracts);
    const cDust = ghosts.dust / gTotal;
    const cFarm = cDust + ghosts.farmerOnly / gTotal;
    for (let i = 0; i < L.n; i++) {
      if (kinds && i < kinds.length) kind[i] = kinds[i];
      else if (i < fans) kind[i] = 0;
      else {
        const r = hash01(i);
        kind[i] = r < cDust ? 1 : r < cFarm ? 2 : 3;
      }
      tone[i] = tifo(kit.pattern, L, i);
    }
    st.kind = kind;
    st.tone = tone;
    api.current.draw();
  }, [total, realFans, ghosts.dust, ghosts.farmerOnly, ghosts.contracts, kit, kinds]);

  // arrival: fans take their seats. Runs once per club.
  useEffect(() => {
    const st = S.current;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!arrival || reduce) {
      st.reveal = 1;
      api.current.draw();
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    st.reveal = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0 - 150) / 1400);
      st.reveal = t <= 0 ? 0 : 1 - Math.pow(1 - t, 2.2);
      api.current.draw();
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      st.reveal = 1;
    };
  }, [arrival, total]);

  useEffect(() => {
    api.current.draw();
  }, [props.focus, props.emphasis, props.pin]);

  return (
    <div ref={wrapRef} className="ground" data-interactive={props.interactive ? '1' : '0'}>
      <canvas ref={canvasRef} role="img" aria-label={props.label} />
      <div ref={pinRef} className="ground-pin" style={{ visibility: 'hidden' }}>
        {props.pin}
      </div>
    </div>
  );
});

export default Ground;
