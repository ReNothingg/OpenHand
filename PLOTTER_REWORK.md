# Plotter rework: acceptance criteria

Hardware is disconnected. Do not issue real device movement, firmware writes,
configuration writes or factory resets during this implementation.

## Required result

- One device profile, connection and command queue across Document, Workshop and Plotter.
- Connection is read-only initialization: no EEPROM writes, automatic motor holding,
  homing, zeroing, program replay or guessed pen position.
- Only the current connection may consume responses, settle commands or close its port.
  Disconnect, reset, alarm and stop cancel in-flight work; late responses cannot restart it.
- A visible stop control on every workspace; no modal or disabled form may hide it.
  Distinguish local cancellation, bytes delivered and a fresh controller report.
  Never describe a successful write as physical motor shutdown.
- Pen setup has independent direction, small explicit movements and two taught positions.
  No guessed position survives a reset. Saved geometry and a live reference are different.
- Jogging uses page directions consistently with exported and streamed geometry.
  No unverified full-area moves; one click cannot queue repeated jogs.
- Job preparation shows one actionable reason when blocked, one progress display and
  clear restart/pause/stop semantics. No duplicate readiness checkboxes or competing zeros.
- Import, dry run, calibration sheets, multi-page jobs and recovery obey the same limits.
- Firmware/settings administration is separate from everyday operation; destructive
  controller actions are explicit and backed up, never hidden in connection/setup.
- Local assets, no gradients, coherent light/dark layout, readable at compact window sizes.
- macOS is the primary delivery. Shared features also exist on Windows.

## Evidence needed

1. Source audit of every movement/configuration path and transport lifecycle.
2. Deterministic controller simulation: delayed/fragmented replies, old session replies,
   missing ok, alarm/reset, stop during open/read/write and disconnection/reconnection.
3. Native pseudo-terminal checks for macOS I/O; no physical plotter attached.
4. Real rendered UI checks of setup, blocked state, stopped state, failed connection,
   running/paused state, keyboard access and compact layout.
5. Typecheck, npm run build, native macOS build, relevant Windows build, bundle parity.
6. Device-specific physical accuracy is not inferred from software tests. Any remaining
   hardware validation must be identified separately and coordinated with the owner.

## Current audit findings

- The old read loop can process data after its reader was replaced. A late ok can settle
  a new connection's pending command. Session ownership needs to cover parsing and cleanup.
- Connection completion can race STOP while the port chooser or initialization is pending.
- Native serial ownership is not exclusive, allowing another OpenHand/debug session to
  change controller settings concurrently.
- STOP delivery still needs separate acknowledgement/state presentation.
- Current pen setup and job readiness need a complete interaction redesign, not another
  layer of warnings or duplicated controls.

## Reference

- https://github.com/gnea/grbl/wiki/Grbl-v1.1-Interface
- https://github.com/gnea/grbl/wiki/Grbl-v1.1-Commands

## First implementation checkpoint

Implemented session ownership in the read loop and command timeouts. STOP/disconnect
cancel a pending port chooser or initialization before it can finish connecting.
Added native macOS TIOCEXCL acquisition. STOP now distinguishes a delivered command
from a fresh Idle/Hold:0/Alarm/Sleep report; a cached report cannot confirm a later stop.
Fixed a Windows raw-string indentation build error in the emergency bridge shim.

Observed verification (hardware disconnected):
- Simulated two consecutive connections; injected old ok and startup banner during a
  pending new movement. Neither advanced the new queue nor closed the new port.
- Cancelled a pending port chooser with STOP: selected device was never opened.
- Initialization writes were exactly $I and $$, including a stepper profile.
- Fresh Hold:0 reported as observed; repeated stop without a new report remained unconfirmed.
- Native macOS class opened/configured a PTY, wrote exact 85 21 18 bytes, received data
  asynchronously and closed. PTY allowed another open, so actual USB exclusivity is NOT
  proven by this test; the exclusive ioctl was accepted.
- npm run build succeeded, including macOS universal build and signature verification.

Remaining: comprehensive transport cancellation/error audit, controller/pen reference
model, full job-path audit, coherent setup and job interface, diagnostic/version visibility,
rendered end-to-end flows and wider failure simulation. Goal is not complete.
