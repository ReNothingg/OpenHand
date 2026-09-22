export interface CommandTicket {
  written: Promise<void>;
  acknowledged: Promise<unknown>;
}

export const MAX_STREAM_RANGE_COMMANDS = 256;

/** GRBL $I reports total RX capacity, unlike Bf which reports currently free bytes. */
export function grblReceiveCapacity(line: string): number | null {
  const match = /^\[OPT:[^,\]\r\n]*,\d+,(\d+)\]$/.exec(line);
  const capacity = match ? Number(match[1]) : NaN;
  return Number.isInteger(capacity) && capacity >= 2 && capacity <= 65536 ? capacity : null;
}

export function grblStreamBudget(capacity: number | null): number {
  return capacity === null ? 0 : Math.max(0, Math.min(100, capacity) - 1);
}

/** Only explicit linear movement enters the window; configuration and barriers never do. */
export function isBufferedMotion(command: string, budget: number): boolean {
  if (budget <= 0 || command.length + 1 > budget || command.length > 79 || /[^\x09\x20-\x7e]/.test(command)) return false;
  const word = /([A-Z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/gi;
  const words = [...command.matchAll(word)];
  if (!words.length || command.replace(word, "").trim()) return false;
  const seen = new Set<string>();
  const modalGroups = new Set<string>();
  let linear = false, coordinate = false;
  for (const match of words) {
    const key = match[1]!.toUpperCase(), value = Number(match[2]);
    if (!Number.isFinite(value)) return false;
    if (key === "G") {
      const group = value === 1 ? "motion" : value === 90 || value === 91 ? "distance" : value === 94 ? "feed" : null;
      if (!group || modalGroups.has(group)) return false;
      modalGroups.add(group);
      if (value === 1) linear = true;
    } else {
      if (!"XYZF".includes(key) || seen.has(key) || (key === "F" && value <= 0)) return false;
      seen.add(key);
      if (key !== "F") coordinate = true;
    }
  }
  return linear && coordinate;
}

/**
 * Multiple acknowledged-in-order lines, but at most one unfinished host write.
 * The caller owns cancellation, RX framing and controller error handling.
 */
export async function streamMotionRange(commands: readonly string[], start: number, end: number, options: {
  budget: number;
  dispatch: (command: string) => CommandTicket;
  ready: () => Promise<void>;
  assertActive: () => void;
  onAcknowledged: (index: number) => void;
}): Promise<void> {
  type Flight = { bytes: number; settled: boolean; error?: unknown; result: Promise<void> };
  const flights: Flight[] = [];
  let used = 0;
  const collect = () => {
    while (flights[0]?.settled) {
      const flight = flights.shift()!;
      used -= flight.bytes;
      if (flight.error !== undefined) throw flight.error;
    }
  };
  for (let index = start; index < end; index++) {
    const command = commands[index]!;
    if (!isBufferedMotion(command, options.budget)) throw new Error("Команда не подходит для буферизованной отправки.");
    const bytes = command.length + 1; // ASCII plus the single GRBL LF.
    collect();
    while (used + bytes > options.budget || flights.length >= 8) {
      await flights[0]!.result;
      collect();
      options.assertActive();
    }
    await options.ready();
    options.assertActive();
    const ticket = options.dispatch(command);
    const flight: Flight = { bytes, settled: false, result: Promise.resolve() };
    used += bytes;
    flights.push(flight);
    flight.result = ticket.acknowledged.then(() => {
      options.assertActive();
      options.onAcknowledged(index);
    }).catch(error => { flight.error = error; }).finally(() => { flight.settled = true; });
    // Never put an entire stroke into the native/browser writer's own queue:
    // STOP needs to invalidate the current write before another one is issued.
    await Promise.race([ticket.written, ticket.acknowledged.then(() => ticket.written)]);
    collect();
    options.assertActive();
  }
  while (flights.length) {
    await flights[0]!.result;
    collect();
    options.assertActive();
  }
}
