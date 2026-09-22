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
- Owner follow-up: manual sheet placement is the normal route; completing the axes
  wizard must not be a prerequisite for writing or manual arrows. Keep configured
  coordinate transforms and program bounds, and keep saved pen heights separate from
  the live reference. A motion-free action sets the XY sheet start in the document
  and workshop, without inferring or changing the vertical reference.

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

## Initial audit findings

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


## Controller fingerprint, operation completion and web-dialog checkpoint

GRBL settings snapshots now require the expected fields plus the batch acknowledgement.
Axes calibration and taught pen values are bound to independent fingerprints. Unchanged
reconnects preserve verification; steps/direction/limits/holding changes invalidate the
relevant scope. Calibration in progress is tied to profile/epoch/axes key and cannot certify
a restarted controller. External profile imports retain values but discard physical proof;
ordinary local reload and trusted profile duplication retain it. Unknown settings expose an
explicit read-only refresh action. macOS system debug-console is excluded from plotter ports.

The shared STOP component now exists inside calibration and paper-change dialogs. Calibration
uses a real HTML dialog, initial heading focus and a sticky stop header; narrow layout no
longer clips the button. Its emergency close uses the central workspace stop handler. Motion
buttons suppress keyboard auto-repeat. Transport operation busy state disables conflicting
controls; ordinary manual jogs wait for completion and require checked axes. Non-jog GRBL
moves use G4 planner synchronization, while $J waits for a fresh Idle report.

A same-packet ok/reset can no longer finish a command or continue a recovery prefix. Cancelled
jobs reject instead of returning apparent success. Unexpected job failure invalidates physical
references. Stuck writes have bounded waits, and status units are captured at receipt rather
than reread during a later React update.

Observed evidence, without physical-device I/O:
- Fingerprint stability/change scope, local profile round trip, imported proof removal.
- Complete settings require final ok; never-resolving writer times out and sends no next move.
- ok + startup/reset in the same input packet rejects both ordinary action and recovery prefix.
- Deferred state updates preserve report-unit interpretation; operation busy clears on completion.
- Non-jog move remains busy after movement ok until its synchronization barrier acknowledges.
- Browser: 390px stop fits; native HTML modal exposes only dialog controls in accessibility,
  Tab moves from heading to STOP, activation closes it and shows the stopped state honestly.

Remaining priority work: native OS file-dialog/quit emergency handling and Windows cold-start
port parity; executed recovery checkpoints and pause/backpressure behavior; manual XY bounds
and canonical modal setup/common import headers; discoverable setup entry points and final
job/paper-change/recovery acceptance pass. Goal remains incomplete.

Verified GRBL planner synchronization against upstream mc_dwell (protocol_buffer_synchronize):
https://github.com/gnea/grbl/blob/master/grbl/motion_control.c . This is controller completion,
not evidence from a physical position sensor.

## Executed recovery checkpoints and acknowledgement deadlines

Recovery records now require version 2 and an actual declared stroke boundary.
Before storing a new boundary, GRBL drains its planner through G4 and Marlin through
M400. An accepted command alone no longer advances persisted recovery. Legacy
accepted-only records are discarded. Failed persistence is visible in the document
and diagnostic export. This confirms controller execution, not physical position.

Acknowledgement deadlines account for explicit dwell duration and fresh GRBL busy
reports. Pausing suspends the deadline; resuming renews it. Fresh Idle reports with
a missing acknowledgement still fail. Controller Hold/Run changes update the job
pause state. Command framing rejects embedded newlines and non-ASCII bytes before
writing. Marlin pen dwell values now use milliseconds as required by its P parameter.

Virtual-controller checks passed: withheld planner acknowledgement preserves the
previous checkpoint, disconnect cannot save an unexecuted boundary, long pause and
fresh busy reports do not lose the queue, Idle missing-ACK still times out, invalid
recovery points and command framing are rejected. No physical-device I/O was used.
Remaining acceptance work listed above is still required; the overall goal is open.

## Native Escape and menu STOP

Bridge version 4 adds a native STOP entry point, independent of JavaScript response.
macOS monitors Escape in the owning window and its sheet hierarchy while connected;
Windows handles WebView key events and the common-dialog message loop. Both expose
a native Plotter > STOP menu item. Repeat keydown is suppressed. Native-origin stop
notifications join the existing JS stop promise; concurrent web/native calls share
the native write, and new writes remain latched until explicit release.

Evidence: actual embedded Mac/Windows shims executed in VM verified native-origin
join, overlapping web STOP, release denial during STOP, and delivery-error propagation.
Extracted actual Swift stop methods with fake transports verified immediate latch,
exact protocol bytes, coalescence, saved-port failure and network dispatch. An isolated
macOS GUI fixture using the actual Escape monitor received Escape
through computer-use in a real NSOpenPanel sheet: native-stop-started was recorded
while the sheet remained open. The fixture had no physical serial implementation.
macOS build, Windows cross-build and 153-file web parity passed. Windows native UI
execution was not available on this Mac; compilation is not runtime UI evidence.

Still outstanding: quit/window-close handling, port ownership and Windows cached-port
parity, manual XY bounds/canonical modal setup, setup discoverability, and final full
job/paper-change/recovery acceptance. This checkpoint does not complete the goal.

## Owner-requested adjustable pen step

The owner requested adjustable jog distance during pen teaching. The panel now offers
0.1 / 0.25 / 0.5 / 1 mm, defaults to 0.1, and stores the choice in the shared profile.
Both movement buttons show the selected distance; changing it sends no commands and
does not invalidate taught positions, reference or axis calibration. The hook and
command generator enforce the same 1 mm maximum. The existing one-operation lock,
completion wait, direction setting and 60 mm/min speed cap are unchanged.

Verified using the real component and usePenControl with a virtual command callback:
choosing 1 mm sends nothing; down sends exactly $J=G21G91Z1F60; choosing 0.25 then up
sends exactly $J=G21G91Z-0.25F60 and updates the position to 0.75. Reload preserves
the selected step while requiring a fresh live reference. Profile serialization,
all four distances and both signs, invalid input rejection and preserved calibration
were checked separately. The rendered picker and labels were inspected. No hardware
commands were issued. Native close/quit work remains unfinished and is not included
in this user-requested step adjustment.

## Manual sheet placement and native close checkpoint

The owner explicitly requested manual positioning instead of compulsory checks.
Removed axes-wizard certification from shared device readiness and manual jog gates;
the configured transform, program bounds, fresh Idle, stop latch, saved pen endpoints
and command policy still apply. Document/workshop now expose “Начало листа здесь”.
The user positions the raised pen over the upper-left sheet corner, then this action
sets XY zero and the saved upper Z/E reference in one transport operation without
movement. It sets the profile origin to upper-left so placement is independent of
machine travel width/height; it does not alter axis direction. Duplicate clicks are
ignored and a changed connection/profile context cannot confirm a stale placement.
The two missing-reference blockers became one actionable instruction.

Observed real component/usePenControl fixture: no initial port commands; placement
emitted only G21, G92Z0, G10P0L20X0Y0; the recording button became enabled without an
axes certificate; subsequent simulated recording produced the expected job commands.
Pure checks covered retained stop/Idle/connection/pen/bounds guards, motion-free
reference commands and upper-left coordinates independent of machine dimensions.

Native bridge 5 adds bounded shutdown preparation and native window/quit hooks on
both platforms. New writes/open/release requests are rejected during close; active
STOP precedes transport close; no live connection means no remembered-port reopen.
Open-generation checks discard late connection completions, and only one opening
may own the native transport. Failed delivery/timeout cancels normal app closure.
Concurrent window close/quit requests join the same preparation. SwiftUI window
delegate behavior is forwarded, with guards installed on view attachment and keying.

Actual Swift shutdown methods with fake transports passed ordering/coalescing,
no cached reopen, failure, timeout and stale-completion cases. In a native GUI fixture
using the actual close guard, closing the window produced: 852118 write, delivered,
serial close, TCP close, disconnect, original delegate approval, window close.
The fixture had no physical transport implementation. macOS and Windows builds and
bundle parity passed; Windows runtime and macOS failed-close dialog interaction are
not yet verified. All temporary test sources are removed before publication.

Remaining: port ownership/cached-port parity, full manual XY boundary and modal-frame
audit, paper-change/recovery interactions, setup discoverability and final acceptance.
Physical motion accuracy remains outside these virtual checks. Goal remains open.

## Incident correction: XY placement must not redefine Z

Owner reported renewed pressure into the sheet after starting a real job, then
confirmed STOP had halted the pressure. Read the running Xcode app's log/settings
through accessibility only; issued no controller commands and left STOP latched.
Observed 07:32:10 G92Z0 in the manual-placement action, followed at 07:32:15 by
G1G90Z7F1; stored upper/lower values were 0/7 and pen speed 1 mm/min, upward direction
negative Z. The device later reported Alarm after stop. These are observed commands,
not proof of the exact physical location or mechanical cause of pressure.

The preceding manual-placement design was unsafe: XY placement silently declared
the actual Z to be the saved upper height. Removed that behavior and the combined
reference/origin API. XY placement now sends only XY origin commands and cannot
make an unknown vertical reference ready for printing. It remains available without
the axes wizard. Explicit reference buttons now say saved upper/lower point, rather
than the ambiguous “currently raised/lowered”. Collision/manual height changes are
not treated as a trustworthy reference.

Also fixed the job estimate, which omitted stepper lift travel entirely. For the
observed 7 mm/F1 configuration, each full vertical move is 420 seconds in G94 mode;
the per-move estimate is now shown before printing and in pen setup, and the overall
estimate includes both vertical moves per stroke. Existing heights and speeds were
not changed. GRBL jobs, recovery, pen actions, frame and return explicitly set G94;
G93 remains rejected by command policy. Upstream reference:
https://raw.githubusercontent.com/gnea/grbl/master/grbl/gcode.c

Regression checks reproduced 420 seconds per move and the 826-second per-stroke
difference between F1 and F60; verified no Z/E in origin commands, unknown vertical
reference still blocks writing, generated GRBL commands pass policy with G94, and
Marlin generation remains free of G94. Native builds are software verification only.
The physical cause of contact force is not claimed solved by these checks.

Further concrete audit item: generated G0 XY travel includes F even though GRBL rapid
uses controller rapid limits. Review travel generation, timing and preview pen-state
interpretation together before changing this behavior.

## Revisited KDraw reverse engineering at the owner's request

Revalidated the existing 3.9.8 installer by SHA-256, read the complete relevant
client call chains, and independently checked them with javap bytecode. Replaced
the contradictory historical KDRAW_PROTOCOL.md with a current evidence report.
Newly traced: startup autoSetZero path; G92 after the settings-read flag; separate
emergency reset versus normal pen-up/return; 100-byte ACK-budget queue; editable
speed presets; and server-side command generation via drawsoftapp rather than a
generator class shipped in this client. Inspected UGS's public GRBL controller and
coordinate helpers as the second application named in the supplied reviews.

An offline compatibility check verified the existing Ozon preset produces the same
Stepper 0/3/1000 pen grammar as the KDraw client (apart from explicit G21/G94), with
zero pen delays. The incident's 0/7/1 profile is distinct, not the built-in preset.
No customer account, remote document submission, vendor executable or hardware was
used. Server-side generation and actual mechanics are not claimed reverse engineered.
The next implementation work should use these verified boundaries, including rapid
travel/feed behavior and pen-state interpretation, rather than adding more guessed
calibration behavior. The overall software goal is still incomplete.

## Controlled travel and explicit preview pen model

Confirmed GRBL G0 behavior against gcode.c and planner.c: the rapid condition uses
the controller rapid rate, not the F value beside G0. Generated inter-stroke travel,
frame, return-to-origin and Marlin relative jog now use G1 with the configured feed.
GRBL manual $J remains unchanged. Imported/custom commands are not rewritten.
Source: https://raw.githubusercontent.com/gnea/grbl/master/grbl/planner.c

Document/workshop/calibration-file exports now add a bounded JSON comment describing
the pen mechanism and up/down values. Streaming command arrays remain comment-free.
Parser models support Z, E with M82/M83 and relative state, servo M3/M280, and spindle
output; the first explicit upper-height command is recognized even if its numeric
Z equals the initial parser value. Explicit trusted profile options take precedence
over file metadata during execution-policy inspection. Metadata changes only display
classification and never bypasses program or hardware readiness checks. Unknown
files retain the heuristic with a visible notice. Travel-only files are displayed.

Evidence without hardware: 9 firmware/pen combinations have exactly 2 drawing
segments/3 mm and matching travel distance; no generated G0 remains; F300 applies
to generated travel; frame-only geometry stays travel; export/import preserves the
original command array; relative E, standalone servo S, malformed metadata and
profile-over-file precedence passed. Real worker/browser preview of positive-Z-down
export displayed two strokes and hid travel on toggle; frame-only export displayed
geometry with zero drawing distance. Temporary fixtures were removed. npm build,
macOS build, Windows cross-build and web parity passed.

Still required: raw-file pen interpretation controls, remaining transport ownership
and reconnect/reference issues, paper-change/recovery full interaction pass, and
final scope audit. This does not establish physical pen force or travel accuracy.
