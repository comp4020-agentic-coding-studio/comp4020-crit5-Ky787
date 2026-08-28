/** Lightweight particle pool: code fragments, sparks and dust. */

const GLYPHS = "0123456789ABCDEFmovpushcalljmpxorlearetsubtest".split("");

export interface Particle {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  colour: string;
  glyph: string | null;
  gravity: number;
  spin: number;
  angle: number;
}

export class Particles {
  private pool: Particle[] = [];
  private cursor = 0;

  constructor(private readonly capacity = 420) {
    for (let i = 0; i < capacity; i += 1) {
      this.pool.push({
        alive: false,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        life: 0,
        maxLife: 1,
        size: 2,
        colour: "#fff",
        glyph: null,
        gravity: 0,
        spin: 0,
        angle: 0,
      });
    }
  }

  private take(): Particle {
    for (let i = 0; i < this.capacity; i += 1) {
      const p = this.pool[(this.cursor + i) % this.capacity];
      if (!p.alive) {
        this.cursor = (this.cursor + i + 1) % this.capacity;
        return p;
      }
    }
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.capacity;
    return p;
  }

  spawn(init: Partial<Particle>): void {
    const p = this.take();
    p.alive = true;
    p.x = init.x ?? 0;
    p.y = init.y ?? 0;
    p.vx = init.vx ?? 0;
    p.vy = init.vy ?? 0;
    p.maxLife = init.maxLife ?? 0.6;
    p.life = p.maxLife;
    p.size = init.size ?? 2;
    p.colour = init.colour ?? "#9fe8ff";
    p.glyph = init.glyph ?? null;
    p.gravity = init.gravity ?? 0;
    p.spin = init.spin ?? 0;
    p.angle = init.angle ?? 0;
  }

  /** Fragments a collapsing bogus block into drifting code shrapnel. */
  shatter(x: number, y: number, w: number, h: number, colour: string): void {
    const count = 26;
    for (let i = 0; i < count; i += 1) {
      const px = x + Math.random() * w;
      const py = y + Math.random() * h;
      this.spawn({
        x: px,
        y: py,
        vx: (Math.random() - 0.5) * 260,
        vy: -Math.random() * 200 - 30,
        maxLife: 0.7 + Math.random() * 0.9,
        size: 9 + Math.random() * 4,
        colour,
        glyph: GLYPHS[(Math.random() * GLYPHS.length) | 0],
        gravity: 900,
        spin: (Math.random() - 0.5) * 8,
        angle: (Math.random() - 0.5) * 1.2,
      });
    }
  }

  burst(x: number, y: number, count: number, colour: string, speed = 260): void {
    for (let i = 0; i < count; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.35 + Math.random() * 0.9);
      this.spawn({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        maxLife: 0.35 + Math.random() * 0.5,
        size: 1.6 + Math.random() * 2.2,
        colour,
        gravity: 420,
      });
    }
  }

  trail(x: number, y: number, colour: string): void {
    this.spawn({
      x,
      y,
      vx: (Math.random() - 0.5) * 40,
      vy: (Math.random() - 0.5) * 40,
      maxLife: 0.28,
      size: 1.8,
      colour,
    });
  }

  update(dt: number): void {
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        continue;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.angle += p.spin * dt;
    }
  }

  clear(): void {
    for (const p of this.pool) p.alive = false;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.pool) {
      if (!p.alive) continue;
      const t = p.life / p.maxLife;
      ctx.globalAlpha = Math.max(0, Math.min(1, t));
      ctx.fillStyle = p.colour;
      if (p.glyph) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.font = `${p.size}px ui-monospace, Menlo, monospace`;
        ctx.fillText(p.glyph, 0, 0);
        ctx.restore();
      } else {
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }
    ctx.globalAlpha = 1;
  }
}
