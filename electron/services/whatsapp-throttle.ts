// WhatsApp send throttle — the anti-ban pacing layer for bulk sending.
//
// Baileys speaks WhatsApp's protocol directly, which WhatsApp's Terms of
// Service do not permit. The single biggest signal WhatsApp uses to detect
// and BAN such accounts is machine-gun sending: many messages in a short
// window, evenly spaced like a robot. This throttle makes every bulk
// campaign behave like a careful human:
//
//   • a random 5–10 s gap between EVERY message (robots space evenly;
//     jitter does not),
//   • a long 4-minute rest after every 20 messages (bulk rest),
//   • NO hard hourly/daily caps — the mahallu decides its own volume;
//     the human-like pacing above is what keeps the number safe. If
//     WhatsApp itself signals a rate limit, the campaign pauses (that
//     reaction lives in whatsapp.service.ts).
//   • counters PERSIST to <userData>/whatsapp/throttle.json so restarting
//     the app cannot skip a due rest or reset the pacing clock.
//
// Receipt sends (one PDF to one recipient, human-paced by button clicks)
// do NOT go through this throttle — the volume risk that gets numbers
// banned is bulk campaigns, and receipts already carry their own privacy
// lock.
//
// Everything (clock, sleep, persistence) is injectable so the unit tests
// run instantly without timers or disk.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export interface ThrottleConfig {
  minGapMs: number;      // smallest gap between two sends
  maxGapMs: number;      // largest gap (jitter upper bound)
  restEvery: number;     // sends after which a long rest is taken (0 = never)
  restMs: number;        // length of that rest
}

export const DEFAULT_THROTTLE: ThrottleConfig = {
  minGapMs: 5_000,
  maxGapMs: 10_000,
  restEvery: 20,
  restMs: 4 * 60_000,
};

interface PersistedCounters {
  sinceRest: number; // sends gone out since the last long rest
  dayKey: string;    // local YYYY-MM-DD
  dayCount: number;  // informational: sends today (shown on the WhatsApp page)
  lastSentAt: number;
}

export interface ThrottleDeps {
  config?: Partial<ThrottleConfig>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Where the counter file lives (…/whatsapp). Null = memory-only (tests). */
  storeDir?: () => string | null;
  /** Override persistence for tests (defaults to a JSON file in storeDir). */
  load?: () => PersistedCounters | null;
  save?: (data: PersistedCounters) => void;
}

function localDayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export class SendThrottle {
  readonly config: ThrottleConfig;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly loadFn: () => PersistedCounters | null;
  private readonly saveFn: (data: PersistedCounters) => void;
  private counters: PersistedCounters;

  constructor(deps: ThrottleDeps = {}) {
    this.config = { ...DEFAULT_THROTTLE, ...(deps.config || {}) };
    this.now = deps.now || (() => Date.now());
    this.sleep = deps.sleep || ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const file = deps.storeDir ? deps.storeDir() : null;
    const filePath = file ? `${file}/throttle.json` : null;
    this.loadFn = deps.load || (() => {
      if (!filePath) return null;
      try {
        const fs = require("node:fs") as typeof import("node:fs");
        return JSON.parse(fs.readFileSync(filePath, "utf-8")) as PersistedCounters;
      } catch { return null; }
    });
    this.saveFn = deps.save || ((data) => {
      if (!filePath) return;
      try {
        const fs = require("node:fs") as typeof import("node:fs");
        const path = require("node:path") as typeof import("node:path");
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(data), "utf-8");
      } catch { /* best effort — a lost counter file only resets pacing */ }
    });
    // Normalize whatever is on disk. Files written by the older capped
    // build ({hourKey, hourCount, …}) simply start fresh on the rest
    // counter while today's count and the pacing clock carry over.
    const raw: any = this.loadFn();
    this.counters = {
      sinceRest: Math.max(0, Math.floor(Number(raw?.sinceRest) || 0)),
      dayKey: typeof raw?.dayKey === "string" ? raw.dayKey : "",
      dayCount: Math.max(0, Math.floor(Number(raw?.dayCount) || 0)),
      lastSentAt: Math.max(0, Number(raw?.lastSentAt) || 0),
    };
  }

  /** Roll the daily counter when the calendar day changed. */
  private rolled(): void {
    const ts = this.now();
    const dk = localDayKey(ts);
    if (this.counters.dayKey !== dk) {
      this.counters.dayKey = dk;
      this.counters.dayCount = 0;
    }
  }

  private persist(): void {
    try { this.saveFn({ ...this.counters }); } catch { /* never break sends */ }
  }

  /** Gap between two sends: the jitter window, widened to the bulk rest
   *  when `withRest` (i.e. `restEvery` sends have already gone out). */
  private gapMs(withRest: boolean): number {
    const { minGapMs, maxGapMs, restMs } = this.config;
    const jitter = minGapMs + Math.random() * Math.max(0, maxGapMs - minGapMs);
    return Math.round(withRest ? Math.max(jitter, restMs) : jitter);
  }

  /** Reserve the next send slot: sleeps the human-gap (jitter, plus the
   *  long bulk rest when one is due) and always allows the send — there
   *  are no volume caps, only pacing. */
  async beforeSend(): Promise<void> {
    this.rolled();
    const dueRest = this.config.restEvery > 0
      && this.counters.sinceRest >= this.config.restEvery;
    const wait = this.counters.lastSentAt
      ? Math.max(0, this.counters.lastSentAt + this.gapMs(dueRest) - this.now())
      : 0;
    if (wait > 0) await this.sleep(wait);
    if (dueRest) {
      this.counters.sinceRest = 0;
      this.persist();
    }
  }

  /** Call right after the socket accepted the message. */
  recordSent(): void {
    this.rolled();
    this.counters.sinceRest++;
    this.counters.dayCount++;
    this.counters.lastSentAt = this.now();
    this.persist();
  }

  /** UI/status snapshot — what the WhatsApp page can show the office. */
  snapshot(): { sentToday: number } {
    this.rolled();
    return { sentToday: this.counters.dayCount };
  }

  /** Test/reset helper — wipes counters in memory (persistence is separate). */
  resetForTests(): void {
    this.counters = { sinceRest: 0, dayKey: "", dayCount: 0, lastSentAt: 0 };
  }
}
