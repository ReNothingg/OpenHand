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


## Pen control checkpoint

Replaced independent pose booleans and duplicated mutation handlers with usePenControl.
Its session context includes connection epoch, device profile, pen mechanism and direction.
Async operations have a revision token and one-operation lock: completion after stop,
profile change or invalidation cannot resurrect a reference or overwrite the new profile.
Fresh GRBL Idle is required for pen actions. Local reset performs no I/O.

Saved positions must be finite, different and ordered according to the independently
configured lift direction. Normal completed jobs preserve the coordinate reference but
forget the last manual setup position; movement to a taught endpoint restores that position.
Removed all pen stages and pen parameter editing from the axes/area calibration wizard.
There is one teaching surface: begin here, short steps, two saved heights, normal up/down
buttons and a separate fine-adjustment disclosure.

Verification completed without physical hardware:
- Hook simulation: teach/save/move; equal and reversed positions rejected; late completion
  after stop/profile switch discarded; overlapping clicks do not queue another jog;
  normal job does not force reteaching; local reset has no writes; stale Idle rejected.
- Real React component with virtual command transport: completed teaching, ordinary up/down,
  disconnect/reconnect with saved heights retained, renewed reference without movement,
  stop blocks save/movement controls. Logged commands match those actions.
- Full application rendered with the new panel and ordinary styles; disconnected controls
  are disabled with one next-step message. Compact layout puts connection before pen setup.

Still not a completed goal: job readiness/streaming/import/recovery path audit, native
transport lifetime edge cases, consolidated diagnostics and whole-application UI pass remain.


## Unified launch checkpoint

All UI launch paths now route through the workspace hardware gate: connection, current
operation, setup, STOP latch, fresh GRBL Idle, taught pen pair, live pen reference and sheet
origin. Removed the independently checkable `armed` state and its duplicate UI controls.
Workshop no longer calls the transport run method directly. Run and recovery compile once,
validate that exact command array and pass that same payload to the transport; preview
configuration may be debounced and must not authorize a different freshly compiled job.

Added execution validation for imported and generated programs (including custom macros):
settings/firmware commands, unmodelled coordinate changes, unknown syntax/movement,
unanchored relative coordinates, wrong pen axes and motion beyond the taught pen range
block streaming. Viewer access is retained for unsupported imports. Workspace bounds use
the same coordinate transform as the generator. Full-circle IJ arcs are now included in
preview bounds. Servo pressure variation is clamped to configured endpoints. Legacy automatic
zeroing is disabled in profile normalization and removed from generator/UI.

Verification (no hardware): shared readiness matrix; valid generated jobs, test sheets and
multi-page queues for GRBL/Marlin/EBB modes; compact-token M104, $1, $N, G53/G92/G28,
relative-first motion, units/Z-range violations and custom macros outside bounds rejected;
full-circle arc bounds captured. Actual UI: document and workshop show the same disconnected
reason and device link, launch disabled, readiness checkbox absent.

Remaining: stop/transport lifecycle completion, imported modal edge cases, diagnostics and
build identity, job progress/recovery/paper-change UI review and final acceptance audit.

Follow-up findings in this checkpoint:
- Hardware gate requires the persisted directions/work-area check on every launch path.
  Pen mechanism/height edits no longer invalidate that independent axes check.
- Standalone S words cannot bypass the configured tool range after a prior M3.
- Generator restores G21/G90 and the raised pen after custom macros so their modal state
  cannot silently turn the document's absolute trajectory into relative/inch moves.
- Generated jobs, calibration sheets and queues passed the policy across applicable modes.
  Final web/macOS bundle parity: 153 files; Windows build succeeded.

## Stop lifecycle and diagnostics checkpoint

STOP is coalesced while pending, latches ordinary writes in both native shims and bridges,
and cannot be cleared by an older asynchronous release after a newer STOP. Port close waits
for the current emergency request; status polling remains permitted. The Windows serial
adapter cancels the current overlapped write before acquiring its lock for emergency data,
and rejects queued writers from the prior epoch. A partial/failed G-code write invalidates
synchronization and physical references, blocking subsequent lines. STOP delivery has a
bounded acknowledgement wait on browser and native paths. An uncertain/errored stream is
closed before releasing control rather than treated as usable.

Native connection requests carry their protocol, so emergency bytes use the remembered
connection protocol. Bridge version 3 is explicit; a stale native shell cannot establish a
new connection with this frontend. Build revision/date and native bridge revision are visible
in a single diagnostic disclosure. Local JSON export includes device state/log, not document
content. Unknown $13 units now hide coordinates and feed rather than label raw values as mm;
release after a successful GRBL reset reads settings, without movement or restoring references.

Verification without plotter access:
- Executed the actual embedded macOS and Windows shim JavaScript with mock native replies:
  repeated STOP coalesces; ordinary late write blocked; '?' allowed; close waits; native
  release required; an old release cannot clear a newer stop; protocol passed on open.
- Hook simulation: old bridge blocked before chooser; connect/release blocked during STOP;
  delayed release race rejected; partial write prevents following movement; unknown units
  hidden and known inch reports converted.
- Launched the built macOS application without connecting: bridge 3 and build timestamp
  visible. Saved diagnostic JSON through NSSavePanel, parsed the file and verified disconnected
  state, empty command log and no document-content fields. Closed the temporary application.
- Web/macOS build and signature verification passed; web copies match (153 files); Windows
  compilation passed. No physical-device stop/driver cancellation claim is inferred.

Remaining acceptance work: full UI/job/paper-change/recovery pass, stop access around modal
and native file dialogs, hardware-setting fingerprint/reference invalidation review, Windows
cold-start saved-port parity, and final requirement-by-requirement audit.
