type Vec = [number, number, number];
type Motion = { kind: "move"; target: Vec; feed: number; jog: boolean };
type Dwell = { kind: "dwell"; seconds: number };
type Block = Motion | Dwell;
type Waiter = { line: string; dwellQueued: boolean };

export type VirtualInkPoint = { x: number; y: number; depth: number };
export type VirtualSnapshot = {
  revision: number;
  powered: boolean;
  state: string;
  physical: Vec;
  paperZ: number;
  speed: number;
  ink: VirtualInkPoint[][];
  inkPoints: number;
  bottomedOut: boolean;
  log: string[];
};

const PLANNER_BLOCKS = 15;
const RX_BUFFER = 128;
const MAX_INK_POINTS = 400_000;
const SPRING_TRAVEL_MM = 4;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const SETTINGS: Record<number, number> = {
  0: 10, 1: 25, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 10: 1, 11: 0.01, 12: 0.002, 13: 0,
  20: 0, 21: 0, 22: 0, 23: 0, 24: 25, 25: 500, 26: 250, 27: 1, 30: 1000, 31: 0, 32: 0,
  100: 80, 101: 80, 102: 400, 110: 6000, 111: 6000, 112: 1000,
  120: 600, 121: 600, 122: 200, 130: 330, 131: 203, 132: 15,
};

const WORD = /([A-Z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/gi;
const format = (value: number) => value.toFixed(3);

function words(line: string) {
  const clean = line.replace(/\([^)]*\)/g, "").replace(/;.*$/, "").replace(/\s+/g, "").toUpperCase();
  const found = [...clean.matchAll(WORD)].map(match => ({ key: match[1]!, value: Number(match[2]) }));
  return { found, valid: clean.replace(WORD, "") === "" && found.every(word => Number.isFinite(word.value)) };
}

export class VirtualGrbl {
  private physical: Vec = [0, 0, 0];
  private bootOffset: Vec = [0, 0, 0];
  private mpos: Vec = [0, 0, 0];
  private g54: Vec = [0, 0, 0];
  private g92: Vec = [0, 0, 0];
  private absolute = true;
  private feed = 0;
  private feedOverride = 100;
  private rapidOverride = 100;
  private state = "Idle";
  private alarm = false;
  private hold = false;
  private planner: Block[] = [];
  private current: Block | null = null;
  private currentProgress = 0;
  private lines: string[] = [];
  private partial = "";
  private waiting: Waiter | null = null;
  private emit: ((bytes: Uint8Array) => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTick = 0;
  private inkStrokes: VirtualInkPoint[][] = [];
  private inkCount = 0;
  private inkOpen = false;
  private listeners = new Set<() => void>();
  private snapshotCache: VirtualSnapshot | null = null;
  private revision = 0;
  private notifyQueued = false;
  private recentLog: string[] = [];
  paperZ = 2.4;
  speed = 1;
  bottomedOut = false;
  powered = false;

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  snapshot(): VirtualSnapshot {
    if (!this.snapshotCache || this.snapshotCache.revision !== this.revision) {
      this.snapshotCache = {
        revision: this.revision,
        powered: this.powered,
        state: this.state,
        physical: [...this.physical] as Vec,
        paperZ: this.paperZ,
        speed: this.speed,
        ink: this.inkStrokes,
        inkPoints: this.inkCount,
        bottomedOut: this.bottomedOut,
        log: this.recentLog,
      };
    }
    return this.snapshotCache;
  }

  private changed() {
    this.revision++;
    if (this.notifyQueued) return;
    this.notifyQueued = true;
    setTimeout(() => {
      this.notifyQueued = false;
      this.listeners.forEach(listener => listener());
    }, 50);
  }

  setPaperDistance(value: number) {
    if (!Number.isFinite(value)) return;
    this.paperZ = Math.max(0.3, Math.min(20, value));
    this.inkOpen = false;
    this.changed();
  }

  setSpeed(value: number) {
    this.speed = [1, 4, 16].includes(value) ? value : 1;
    this.changed();
  }

  clearPaper() {
    this.inkStrokes = [];
    this.inkCount = 0;
    this.inkOpen = false;
    this.bottomedOut = false;
    this.changed();
  }

  liftPenByHand() {
    if (this.state !== "Idle" && this.state !== "Alarm") return;
    this.physical = [this.physical[0], this.physical[1], 0];
    this.bootOffset = [this.physical[0] - this.mpos[0], this.physical[1] - this.mpos[1], -this.mpos[2]];
    this.inkOpen = false;
    this.changed();
  }

  attach(emit: (bytes: Uint8Array) => void) {
    this.emit = emit;
    this.powered = true;
    this.boot(false, true);
    this.lastTick = performance.now();
    this.timer ??= setInterval(() => this.tick(), 10);
    this.changed();
    setTimeout(() => this.send("\r\nGrbl 1.1h ['$' for help]"), 250);
  }

  detach() {
    this.emit = null;
    this.powered = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.planner = [];
    this.current = null;
    this.lines = [];
    this.waiting = null;
    this.state = "Idle";
    this.inkOpen = false;
    this.changed();
  }

  private boot(keepAlarm: boolean, powerCycle: boolean) {
    if (powerCycle) {
      this.bootOffset = [...this.physical] as Vec;
      this.mpos = [0, 0, 0];
    }
    this.g92 = [0, 0, 0];
    this.absolute = true;
    this.feed = 0;
    this.feedOverride = 100;
    this.rapidOverride = 100;
    this.planner = [];
    this.current = null;
    this.lines = [];
    this.partial = "";
    this.waiting = null;
    this.hold = false;
    this.alarm = keepAlarm;
    this.state = keepAlarm ? "Alarm" : "Idle";
    this.inkOpen = false;
  }

  private send(text: string) {
    this.emit?.(encoder.encode(`${text}\r\n`));
    const visible = text.trim();
    if (visible && !visible.startsWith("<")) this.recentLog = [...this.recentLog.slice(-40), `← ${visible}`];
  }

  private report() {
    const wco = [0, 1, 2].map(i => this.g54[i]! + this.g92[i]!);
    const motion = this.current?.kind === "move" ? this.current.feed * (this.current.jog ? 1 : this.feedOverride / 100) : 0;
    this.send(`<${this.state}|MPos:${this.mpos.map(format).join(",")}|FS:${Math.round(motion)},0|WCO:${wco.map(format).join(",")}|Ov:${this.feedOverride},${this.rapidOverride},100>`);
  }

  receive(chunk: Uint8Array) {
    for (const byte of chunk) {
      if (byte === 0x3f) { this.report(); continue; }
      if (byte === 0x21) { this.feedHold(); continue; }
      if (byte === 0x7e) { this.cycleStart(); continue; }
      if (byte === 0x18) { this.softReset(); continue; }
      if (byte === 0x85) { this.jogCancel(); continue; }
      if (byte === 0x90) { this.feedOverride = 100; continue; }
      if (byte === 0x91) { this.feedOverride = Math.min(200, this.feedOverride + 10); continue; }
      if (byte === 0x92) { this.feedOverride = Math.max(10, this.feedOverride - 10); continue; }
      if (byte === 0x93) { this.feedOverride = Math.min(200, this.feedOverride + 1); continue; }
      if (byte === 0x94) { this.feedOverride = Math.max(10, this.feedOverride - 1); continue; }
      if (byte === 0x95) { this.rapidOverride = 100; continue; }
      if (byte === 0x96) { this.rapidOverride = 50; continue; }
      if (byte === 0x97) { this.rapidOverride = 25; continue; }
      if (byte >= 0x80) continue;
      const char = decoder.decode(new Uint8Array([byte]));
      if (char === "\n" || char === "\r") {
        const line = this.partial.trim();
        this.partial = "";
        if (line) this.lines.push(line);
      } else if (this.partial.length < RX_BUFFER) this.partial += char;
    }
    this.processLines();
  }

  private feedHold() {
    if (this.state === "Jog") { this.jogCancel(); return; }
    if (this.state === "Run" || this.current) { this.hold = true; this.state = "Hold:0"; this.changed(); }
  }

  private cycleStart() {
    if (!this.hold) return;
    this.hold = false;
    this.state = this.current || this.planner.length ? "Run" : "Idle";
    this.changed();
  }

  private jogCancel() {
    if (this.current?.kind === "move" && this.current.jog) this.current = null;
    this.planner = this.planner.filter(block => !(block.kind === "move" && block.jog));
    if (!this.current && !this.planner.length) this.state = this.alarm ? "Alarm" : "Idle";
    this.changed();
  }

  private softReset() {
    const moving = Boolean(this.current || this.planner.length) && !this.hold;
    this.boot(moving || this.alarm, false);
    if (moving) {
      this.send("ALARM:3");
      this.recentLog = [...this.recentLog.slice(-40), "Сброс во время движения: позиция потеряна"];
    }
    this.send("\r\nGrbl 1.1h ['$' for help]");
    if (this.alarm) this.send("[MSG:'$H'|'$X' to unlock]");
    this.changed();
  }

  private idle() {
    return !this.current && !this.planner.length;
  }

  private processLines() {
    while (this.lines.length) {
      this.waiting ??= { line: this.lines[0]!, dwellQueued: false };
      const result = this.execute(this.waiting);
      if (result === "wait") return;
      this.waiting = null;
      this.lines.shift();
      this.send(result);
    }
  }

  private execute(waiter: Waiter): string | "wait" {
    const line = waiter.line;
    if (line.startsWith("$")) return this.system(line);
    if (this.alarm) return "error:9";
    const { found, valid } = words(line);
    if (!valid || !found.length) return "error:1";
    const g = found.filter(word => word.key === "G").map(word => word.value);
    const m = found.filter(word => word.key === "M").map(word => word.value);
    const value = (key: string) => found.filter(word => word.key === key).at(-1)?.value;
    const supportedG = [0, 1, 4, 10, 17, 21, 49, 54, 90, 91, 92, 94];
    if (g.some(code => !supportedG.includes(code)) || m.some(code => ![3, 5, 2, 30].includes(code))) return "error:20";
    const needsSync = g.some(code => [4, 10, 92].includes(code)) || m.length > 0;
    if (needsSync && !this.idle()) return "wait";
    const motionCode = g.find(code => code === 0 || code === 1);
    const isMotion = motionCode !== undefined || (["X", "Y", "Z"].some(axis => value(axis) !== undefined) && !g.some(code => [4, 10, 92].includes(code)));
    if (isMotion && this.planner.length >= PLANNER_BLOCKS) return "wait";
    if (g.includes(90)) this.absolute = true;
    if (g.includes(91)) this.absolute = false;
    const f = value("F");
    if (f !== undefined) {
      if (f <= 0) return "error:22";
      this.feed = f;
    }
    if (g.includes(4)) {
      if (waiter.dwellQueued) return this.idle() ? "ok" : "wait";
      const p = value("P") ?? 0;
      if (p < 0) return "error:2";
      this.planner.push({ kind: "dwell", seconds: p });
      waiter.dwellQueued = true;
      return "wait";
    }
    if (g.includes(10)) {
      if (value("L") !== 20 || (value("P") ?? 0) > 1) return "error:3";
      (["X", "Y", "Z"] as const).forEach((axis, i) => {
        const target = value(axis);
        if (target !== undefined) this.g54[i] = this.mpos[i]! - this.g92[i]! - target;
      });
      this.changed();
      return "ok";
    }
    if (g.includes(92)) {
      (["X", "Y", "Z"] as const).forEach((axis, i) => {
        const target = value(axis);
        if (target !== undefined) this.g92[i] = this.mpos[i]! - this.g54[i]! - target;
      });
      this.changed();
      return "ok";
    }
    if (isMotion) {
      const rapid = motionCode === 0;
      if (!rapid && !this.feed) return "error:22";
      const target = this.targetFrom(value("X"), value("Y"), value("Z"), this.absolute);
      const feed = rapid ? Math.min(SETTINGS[110]!, SETTINGS[111]!) * this.rapidOverride / 100 : this.feed;
      this.queueMove(target, feed, false);
      return "ok";
    }
    return "ok";
  }

  private targetFrom(x: number | undefined, y: number | undefined, z: number | undefined, absolute: boolean): Vec {
    const last = this.planner.filter((block): block is Motion => block.kind === "move").at(-1)?.target
      ?? (this.current?.kind === "move" ? this.current.target : this.mpos);
    const wco = [0, 1, 2].map(i => this.g54[i]! + this.g92[i]!);
    return [x, y, z].map((v, i) => v === undefined ? last[i]! : absolute ? v + wco[i]! : last[i]! + v) as Vec;
  }

  private queueMove(target: Vec, feed: number, jog: boolean) {
    this.planner.push({ kind: "move", target, feed, jog });
    if (!this.hold) this.state = jog ? "Jog" : "Run";
    this.changed();
  }

  private system(line: string): string | "wait" {
    const command = line.toUpperCase().replace(/\s+/g, "");
    if (command === "$I") {
      this.send("[VER:1.1h.20190825:OpenHand virtual]");
      this.send(`[OPT:V,${PLANNER_BLOCKS},${RX_BUFFER}]`);
      return "ok";
    }
    if (command === "$$") {
      Object.entries(SETTINGS).forEach(([key, value]) => this.send(`$${key}=${Number.isInteger(value) ? value : value.toFixed(3)}`));
      return "ok";
    }
    if (command === "$G") {
      this.send(`[GC:G1 G54 G17 G21 ${this.absolute ? "G90" : "G91"} G94 M5 M9 T0 F${this.feed} S0]`);
      return "ok";
    }
    if (command === "$#") {
      this.send(`[G54:${this.g54.map(format).join(",")}]`);
      this.send(`[G92:${this.g92.map(format).join(",")}]`);
      this.send("[TLO:0.000]");
      return "ok";
    }
    if (command === "$X") {
      if (this.alarm) this.send("[MSG:Caution: Unlocked]");
      this.alarm = false;
      if (this.idle()) this.state = "Idle";
      this.changed();
      return "ok";
    }
    if (command === "$H") return "error:5";
    if (command.startsWith("$J=")) {
      if (this.alarm) return "error:9";
      if (this.state !== "Idle" && this.state !== "Jog") return "error:8";
      const { found, valid } = words(command.slice(3));
      if (!valid) return "error:1";
      const g = found.filter(word => word.key === "G").map(word => word.value);
      const value = (key: string) => found.filter(word => word.key === key).at(-1)?.value;
      const feed = value("F");
      if (!feed || feed <= 0) return "error:22";
      if (this.planner.length >= PLANNER_BLOCKS) return "wait";
      const target = this.targetFrom(value("X"), value("Y"), value("Z"), !g.includes(91));
      this.queueMove(target, feed, true);
      return "ok";
    }
    if (/^\$\d+=/.test(command)) return "error:8";
    if (command === "$") return "ok";
    return "error:3";
  }

  private tick() {
    const now = performance.now();
    let budget = Math.min(0.25, (now - this.lastTick) / 1000) * this.speed;
    this.lastTick = now;
    if (!this.powered) return;
    let moved = false;
    while (budget > 0 && !this.hold) {
      if (!this.current) {
        const next = this.planner.shift();
        if (!next) break;
        this.current = next;
        this.currentProgress = 0;
        if (next.kind === "move") this.state = next.jog ? "Jog" : "Run";
      }
      const block = this.current;
      if (block.kind === "dwell") {
        const left = block.seconds - this.currentProgress;
        const used = Math.min(left, budget);
        this.currentProgress += used;
        budget -= used;
        if (this.currentProgress >= block.seconds - 1e-9) this.current = null;
        continue;
      }
      const start = this.mpos;
      const delta = block.target.map((v, i) => v - start[i]!);
      const length = Math.hypot(...delta);
      const feed = block.feed * (block.jog ? 1 : this.feedOverride / 100);
      const zRate = SETTINGS[112]!;
      const zShare = length ? Math.abs(delta[2]!) / length : 0;
      const limited = zShare > 0 ? Math.min(feed, zRate / zShare) : feed;
      const rate = Math.max(1, limited) / 60;
      const step = Math.min(length, rate * budget);
      budget -= length ? step / rate : 0;
      const t = length ? step / length : 1;
      const next = start.map((v, i) => v + delta[i]! * t) as Vec;
      this.advance(next);
      moved = true;
      if (t >= 1 - 1e-9) {
        this.mpos = [...block.target] as Vec;
        this.current = null;
      }
    }
    if (!this.current && !this.planner.length && !this.hold && !this.alarm && this.state !== "Idle") {
      this.state = "Idle";
      moved = true;
    }
    if (this.waiting) this.processLines();
    if (moved) this.changed();
  }

  private advance(next: Vec) {
    const from = this.physical;
    const to = [0, 1, 2].map(i => next[i]! + this.bootOffset[i]!) as Vec;
    this.mpos = next;
    this.physical = to;
    const depthFrom = from[2] - this.paperZ, depthTo = to[2] - this.paperZ;
    if (depthTo > SPRING_TRAVEL_MM && !this.bottomedOut) {
      this.bottomedOut = true;
      this.recentLog = [...this.recentLog.slice(-40), "Перо упёрлось: держатель сжат до конца"];
    }
    if (depthFrom <= 0 && depthTo <= 0) { this.inkOpen = false; return; }
    const lerp = (t: number): VirtualInkPoint => ({
      x: from[0] + (to[0] - from[0]) * t,
      y: from[1] + (to[1] - from[1]) * t,
      depth: Math.min(SPRING_TRAVEL_MM, Math.max(0, depthFrom + (depthTo - depthFrom) * t)),
    });
    const crossing = depthFrom === depthTo ? 0 : -depthFrom / (depthTo - depthFrom);
    if (depthFrom <= 0) {
      this.inkOpen = false;
      this.addInk(lerp(Math.max(0, Math.min(1, crossing))));
      this.addInk(lerp(1));
    } else if (depthTo <= 0) {
      if (!this.inkOpen) this.addInk(lerp(0));
      this.addInk(lerp(Math.max(0, Math.min(1, crossing))));
      this.inkOpen = false;
    } else {
      if (!this.inkOpen) this.addInk(lerp(0));
      this.addInk(lerp(1));
    }
  }

  private addInk(point: VirtualInkPoint) {
    if (this.inkCount >= MAX_INK_POINTS) return;
    if (!this.inkOpen) {
      this.inkStrokes = [...this.inkStrokes, [point]];
      this.inkOpen = true;
    } else {
      const stroke = this.inkStrokes[this.inkStrokes.length - 1]!;
      const last = stroke[stroke.length - 1]!;
      if (Math.hypot(point.x - last.x, point.y - last.y) < 0.02 && Math.abs(point.depth - last.depth) < 0.02) return;
      stroke.push(point);
      this.inkStrokes = [...this.inkStrokes.slice(0, -1), stroke];
    }
    this.inkCount++;
  }
}

let shared: VirtualGrbl | null = null;
export function virtualPlotter() {
  shared ??= new VirtualGrbl();
  return shared;
}

export function createVirtualSerialPort(device = virtualPlotter()) {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let open = false;
  const port = {
    readable: null as ReadableStream<Uint8Array> | null,
    writable: null as WritableStream<Uint8Array> | null,
    async open() {
      if (open) throw new Error("Виртуальный плоттер уже подключён.");
      if (device.powered) throw new Error("Виртуальный плоттер занят другим подключением.");
      open = true;
      port.readable = new ReadableStream<Uint8Array>({
        start(value) { controller = value; },
        cancel() { controller = null; },
      });
      port.writable = new WritableStream<Uint8Array>({
        write(chunk) {
          if (!open) throw new Error("Виртуальный плоттер отключён.");
          device.receive(chunk);
        },
      });
      device.attach(bytes => {
        try { controller?.enqueue(bytes); } catch { controller = null; }
      });
    },
    async close() {
      if (!open) return;
      open = false;
      device.detach();
      try { controller?.close(); } catch { controller = null; }
      controller = null;
    },
    async setSignals() {},
    getInfo() { return { virtual: true }; },
  };
  return port;
}
