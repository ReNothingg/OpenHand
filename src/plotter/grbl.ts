export interface GrblStatus {
  state: string;
  machine?: number[];
  work?: number[];
  offset?: number[];
  feed?: number;
  spindle?: number;
  overrides?: number[];
  pins?: string;
  receivedAt: number;
}
const vector = (value: string | undefined) => {
  if (!value) return undefined;
  if (value.split(",").some((part) => !part.trim())) return undefined;
  const numbers = value.split(",").map(Number);
  return numbers.length >= 3 &&
    numbers.length <= 6 &&
    numbers.every(Number.isFinite)
    ? numbers
    : undefined;
};
export function parseGrblStatus(
  line: string,
  previous?: GrblStatus | null,
): GrblStatus | null {
  if (!/^<[^<>]+>$/.test(line)) return null;
  const [state, ...parts] = line.slice(1, -1).split("|");
  if (
    !/^(Idle|Run|Hold(?::\d+)?|Jog|Alarm|Door(?::\d+)?|Check|Home|Sleep)$/.test(
      state,
    )
  )
    return null;
  const fields = Object.fromEntries(
    parts.map((part) => {
      const i = part.indexOf(":");
      return [part.slice(0, i), part.slice(i + 1)];
    }),
  );
  const offset =
    fields.WCO === undefined ? previous?.offset : vector(fields.WCO);
  let machine = vector(fields.MPos),
    work = vector(fields.WPos);
  if (machine && offset?.length === machine.length)
    work = machine.map((n, i) => n - offset![i]);
  if (work && offset?.length === work.length)
    machine = work.map((n, i) => n + offset![i]);
  const fs = fields.FS?.split(",").map(Number);
  return {
    state,
    machine,
    work,
    offset,
    feed: fs && Number.isFinite(fs[0]) ? fs[0] : undefined,
    spindle: fs && Number.isFinite(fs[1]) ? fs[1] : undefined,
    overrides: vector(fields.Ov) || previous?.overrides,
    pins: fields.Pn || "",
    receivedAt: Date.now(),
  };
}
export const GRBL_REALTIME = {
  status: 0x3f,
  feedReset: 0x90,
  feedPlus10: 0x91,
  feedMinus10: 0x92,
  feedPlus1: 0x93,
  feedMinus1: 0x94,
  rapid100: 0x95,
  rapid50: 0x96,
  rapid25: 0x97,
  jogCancel: 0x85,
} as const;
