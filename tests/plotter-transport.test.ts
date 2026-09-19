import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

// Exercise the actual transport hook against an in-memory serial device.
// React's lifecycle is deliberately inert: no physical ports or status timers.
const hooks = vi.hoisted(() => ({
  refs: [] as any[],
  states: [] as any[],
  refIndex: 0,
  stateIndex: 0,
}));
vi.mock("react", () => ({
  useCallback: (fn: any) => fn,
  useEffect: () => {},
  useRef: (value: any) => {
    const i = hooks.refIndex++;
    return (hooks.refs[i] ||= { current: value });
  },
  useState: (initial: any) => {
    const i = hooks.stateIndex++;
    if (!(i in hooks.states))
      hooks.states[i] = typeof initial === "function" ? initial() : initial;
    return [
      hooks.states[i],
      (value: any) => {
        hooks.states[i] =
          typeof value === "function" ? value(hooks.states[i]) : value;
      },
    ];
  },
}));
import { usePlotter } from "../src/hooks/usePlotter";
const render = () => {
  hooks.refIndex = 0;
  hooks.stateIndex = 0;
  return usePlotter();
};

describe("serial stream ownership and synchronization", () => {
  let incoming: ReadableStreamDefaultController<Uint8Array>;
  let writes: number[][];
  let device: ReturnType<typeof usePlotter>;
  const reply = (line: string) =>
    incoming.enqueue(new TextEncoder().encode(line + "\r\n"));
  const flush = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };
  const commands = () =>
    writes.map((bytes) => new TextDecoder().decode(new Uint8Array(bytes)));
  beforeEach(async () => {
    hooks.refs = [];
    hooks.states = [];
    hooks.refIndex = 0;
    hooks.stateIndex = 0;
    writes = [];
    const storage = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => storage.get(k) || null,
        setItem: (k: string, v: string) => storage.set(k, v),
        removeItem: (k: string) => storage.delete(k),
      },
    });
    const port = {
      open: async () => {},
      close: async () => {},
      setSignals: async () => {},
      readable: new ReadableStream<Uint8Array>({
        start(controller) {
          incoming = controller;
        },
      }),
      writable: new WritableStream<Uint8Array>({
        write(bytes) {
          writes.push([...bytes]);
        },
      }),
    };
    vi.stubGlobal("navigator", { serial: { requestPort: async () => port } });
    device = render();
    await device.connect("grbl", { baudRate: 115200 });
    device = render();
    writes = [];
  });
  afterEach(async () => {
    await device.disconnect();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("never mixes a manual command or a second job into the active stream", async () => {
    const run = device.run(["G21", "G90"]);
    await flush();
    await expect(device.sendCommands(["G0X50"])).rejects.toThrow(/операции/);
    await expect(device.run(["G0X99"])).rejects.toThrow(/операции/);
    expect(commands()).toEqual(["G21\r\n"]);
    reply("ok");
    await flush();
    reply("ok");
    await flush();
    expect(commands().at(-1)).toBe("G4P0.01\r\n");
    expect(render().status).toBe("running");
    reply("ok");
    await run;
    expect(render().status).toBe("connected");
  });

  it("does not mistake telemetry for command acknowledgement", async () => {
    const run = device.run(["G1X10"]);
    await flush();
    reply("<Run|MPos:1,2,3|WCO:0,0,0>");
    await flush();
    expect(commands()).toHaveLength(1);
    expect(render().machineStatus?.work).toEqual([1, 2, 3]);
    reply("ok");
    await flush();
    reply("ok");
    await run;
  });

  it("sends override commands as bytes outside the acknowledgement queue", async () => {
    const run = device.run(["G1X10"]);
    await flush();
    await device.realtime("feedPlus10");
    expect(writes.at(-1)).toEqual([0x91]);
    reply("ok");
    await flush();
    reply("ok");
    await run;
  });

  it("stops immediately on alarm and never sends the next move", async () => {
    const run = device.run(["G1X10", "G1X20"]);
    const failure = expect(run).rejects.toThrow(/ALARM/);
    await flush();
    reply("ALARM:1");
    await failure;
    expect(commands()).not.toContain("G1X20\r\n");
    await expect(device.sendCommands(["G90"])).rejects.toThrow(/синхронизация/);
  });

  it("locks a timed-out connection so a late ok cannot authorize another move", async () => {
    vi.useFakeTimers();
    const run = device.run(["G1X10", "G1X20"]);
    const failure = expect(run).rejects.toThrow(/не ответил/);
    await flush();
    await vi.advanceTimersByTimeAsync(12001);
    await failure;
    reply("ok");
    await flush();
    await expect(device.sendCommands(["G0X99"])).rejects.toThrow(
      /синхронизация/,
    );
    expect(commands()).not.toContain("G0X99\r\n");
  });

  it("rejects in-flight work on EOF and marks the connection disconnected", async () => {
    const run = device.run(["G1X10", "G1X20"]);
    const failure = expect(run).rejects.toThrow(/закрыт/);
    await flush();
    incoming.close();
    await failure;
    expect(render().status).toBe("disconnected");
    expect(commands()).not.toContain("G1X20\r\n");
  });
});
