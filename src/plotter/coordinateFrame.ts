// Live references are established explicitly in this frame. Never send this on connect.
export const COORDINATE_FRAME_VERSION = "fixed-grbl-g54-v1";

export function coordinateFrameCommands(config: { profile: string; penMode?: string }): string[] {
  if (config.profile === "ebb") return [];
  if (config.profile === "grbl") return ["G21", "G90", "G94", "G17", "G54", "G49"];
  return ["G21", "G90", ...(config.penMode === "estepper" ? ["M82"] : [])];
}
