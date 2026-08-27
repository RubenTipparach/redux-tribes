//! The wasm boundary.
//!
//! Deliberately a C ABI over a flat f32 scratch buffer rather than
//! wasm-bindgen. The simulation's whole interface is numeric (poses, orders,
//! stats in; poses out), so there is nothing for object marshalling to do, and
//! avoiding the glue keeps the build to plain `cargo build --target
//! wasm32-unknown-unknown` with no extra toolchain. The TypeScript side reads
//! and writes the same buffer through a Float32Array view.
//!
//! Layout of the scratch buffer, in f32 slots:
//!
//!   IN   0..2   position
//!        3..5   velocity, units per second
//!        6..9   orientation quaternion (x, y, z, w)
//!       10..12  target
//!       13..15  commanded facing
//!       16      1 if a target was given, else 0
//!       17      1 if a facing was commanded, else 0
//!       18..23  flight stats: yaw, pitch, fwd, retro, lat, max speed
//!
//!   OUT 32..34  end position
//!       35..37  end velocity
//!       38..41  end orientation
//!       42      1 if the mode is committed
//!       64..    path samples, 7 floats each: pos(3) + quat(4)
//!
//! Everything is f32 and little endian on both sides, which wasm guarantees.
//!
//! Beyond the single flight query above, the core also owns a whole MATCH.
//! State lives in Rust; the client submits orders and reads records back. That
//! direction matters: if the client owned the state it would have to be
//! serialised across the boundary every turn AND kept identical to whatever a
//! second client believed, which is the divergence lockstep exists to catch
//! (ADR-6). One owner, one truth, and the boundary carries only what is drawn.
//!
//! Record layouts, all f32, all written from slot 64:
//!
//!   ship   40 slots: id, class, faction, isPlayer, destroyed, hull, hullMax,
//!          marines, pos(3), quat(4), vel(3), mode, drifting, subCount,
//!          sub hp+dead (3 pairs), weaponCount, lastFiredTurn (3),
//!          partyCount, party faction+count (2 pairs)
//!   event  14 slots: kind, tick, ship, other, aux, amount, pos(3), to(3)
//!   pose    9 slots: id, destroyed, pos(3), quat(4)
//!   proj    5 slots: id, kind, pos(3)

use crate::data::{class_index, class_from_index, ship_class};
use crate::flight::{can_reach, fly_span, fly_turn, Body, Flight, Mode, TICKS_PER_SECOND, TICKS_PER_TURN};
use crate::math::{Quat, V3};
use crate::state::{Faction, ProjKind, Sim, SpawnSpec, Winner};
use crate::turn::{Event, FireOrder, Order};

/// Sized for the largest single payload the boundary carries, which is the
/// 601 sample path (4207 slots). Everything else pages through the same space.
const SCRATCH_LEN: usize = 16384;
static mut SCRATCH: [f32; SCRATCH_LEN] = [0.0; SCRATCH_LEN];

const OUT: usize = 64;
pub const SHIP_STRIDE: usize = 40;
pub const EVENT_STRIDE: usize = 14;
pub const POSE_STRIDE: usize = 9;
pub const PROJ_STRIDE: usize = 5;

/// The match the client is playing. Single threaded by construction: wasm has
/// one thread, and a second match would need a handle in every call for no
/// gain the client cannot get by instantiating the module twice.
static mut MATCH: Option<Sim> = None;
static mut ORDERS: Vec<Option<Order>> = Vec::new();
static mut EVENTS: Vec<Event> = Vec::new();

#[allow(static_mut_refs)]
fn sim_opt() -> Option<&'static mut Sim> {
    unsafe { MATCH.as_mut() }
}

#[allow(static_mut_refs)]
fn orders() -> &'static mut Vec<Option<Order>> {
    unsafe { &mut ORDERS }
}

#[allow(static_mut_refs)]
fn events() -> &'static mut Vec<Event> {
    unsafe { &mut EVENTS }
}

fn scratch() -> &'static mut [f32] {
    unsafe { &mut *(&raw mut SCRATCH) }
}

/// Pointer to the shared scratch buffer. The caller maps a Float32Array over
/// wasm memory at this offset and reads and writes the slots above.
#[no_mangle]
pub extern "C" fn ft_scratch_ptr() -> *mut f32 {
    &raw mut SCRATCH as *mut f32
}

#[no_mangle]
pub extern "C" fn ft_scratch_len() -> u32 {
    SCRATCH_LEN as u32
}

fn read_inputs(s: &[f32]) -> (Body, Option<V3>, Option<V3>, Flight) {
    let body = Body {
        pos: V3::new(s[0], s[1], s[2]),
        vel: V3::new(s[3], s[4], s[5]),
        quat: Quat { x: s[6], y: s[7], z: s[8], w: s[9] },
    };
    let target = if s[16] != 0.0 { Some(V3::new(s[10], s[11], s[12])) } else { None };
    let face = if s[17] != 0.0 { Some(V3::new(s[13], s[14], s[15])) } else { None };
    let fl = Flight {
        yaw_rate: s[18],
        pitch_rate: s[19],
        accel_fwd: s[20],
        accel_retro: s[21],
        accel_lat: s[22],
        max_speed: s[23],
    };
    (body, target, face, fl)
}

/// Fly one turn. Returns how many path samples were written from slot 64.
///
/// `sample_stride` thins the recorded path: 1 keeps every slice, 10 keeps every
/// tenth. The renderer wants a few dozen points for a line, not 601.
#[no_mangle]
pub extern "C" fn ft_fly_turn(mode: u32, steps: u32, sample_stride: u32) -> u32 {
    let s: &mut [f32] = unsafe { &mut *(&raw mut SCRATCH) };
    let (body, target, face, fl) = read_inputs(s);
    let mode = Mode::from_u32(mode);
    let target = if mode.committed() { None } else { target };

    let flown = fly_turn(body, target, mode, &fl, face, steps);

    s[32] = flown.end_pos.x;
    s[33] = flown.end_pos.y;
    s[34] = flown.end_pos.z;
    s[35] = flown.end_vel.x;
    s[36] = flown.end_vel.y;
    s[37] = flown.end_vel.z;
    s[38] = flown.end_quat.x;
    s[39] = flown.end_quat.y;
    s[40] = flown.end_quat.z;
    s[41] = flown.end_quat.w;
    s[42] = if mode.committed() { 1.0 } else { 0.0 };

    let stride = sample_stride.max(1) as usize;
    let mut n = 0usize;
    let mut i = 0usize;
    while i < flown.path.len() {
        let base = 64 + n * 7;
        if base + 7 > SCRATCH_LEN {
            break;
        }
        let (p, q) = flown.path[i];
        s[base] = p.x;
        s[base + 1] = p.y;
        s[base + 2] = p.z;
        s[base + 3] = q.x;
        s[base + 4] = q.y;
        s[base + 5] = q.z;
        s[base + 6] = q.w;
        n += 1;
        i += stride;
    }
    n as u32
}

/// The reachability probe, one cell at a time. Reads the same inputs; the
/// target slots carry the candidate point.
#[no_mangle]
pub extern "C" fn ft_can_reach(mode: u32, eps: f32, steps: u32) -> u32 {
    let s: &[f32] = unsafe { &*(&raw const SCRATCH) };
    let (body, _t, face, fl) = read_inputs(s);
    let target = V3::new(s[10], s[11], s[12]);
    can_reach(body, target, Mode::from_u32(mode), &fl, face, eps, steps) as u32
}

/// Sweep a whole grid of candidate cells in one call, so probing an envelope
/// costs one boundary crossing instead of several thousand. Cells are written
/// back as a bitmask, 32 cells per u32, from slot 64.
#[no_mangle]
pub extern "C" fn ft_reach_grid(mode: u32, eps: f32, steps: u32, n: u32, cx: f32, cy: f32, cz: f32, half: f32) -> u32 {
    let s: &mut [f32] = unsafe { &mut *(&raw mut SCRATCH) };
    let (body, _t, face, fl) = read_inputs(s);
    let mode = Mode::from_u32(mode);
    let n = n.max(1).min(32) as usize;
    let step = 2.0 * half / n as f32;
    let mut hits = 0u32;
    let mut idx = 0usize;
    let words = (n * n * n).div_ceil(32);
    for w in 0..words {
        if 64 + w < SCRATCH_LEN {
            s[64 + w] = 0.0;
        }
    }
    let mut mask = vec![0u32; words];
    for i in 0..n {
        let x = cx - half + (i as f32 + 0.5) * step;
        for j in 0..n {
            let y = cy - half + (j as f32 + 0.5) * step;
            for k in 0..n {
                let z = cz - half + (k as f32 + 0.5) * step;
                if can_reach(body, V3::new(x, y, z), mode, &fl, face, eps, steps) {
                    mask[idx / 32] |= 1 << (idx % 32);
                    hits += 1;
                }
                idx += 1;
            }
        }
    }
    for (w, word) in mask.iter().enumerate() {
        if 64 + w < SCRATCH_LEN {
            s[64 + w] = f32::from_bits(*word);
        }
    }
    hits
}

// ------------------------------------------------------------- the match --

/// Start a skirmish. The seed arrives as two u32 halves and is reassembled
/// into the same 16 character hex string the server issues, so a client and
/// the server name the same match without any string marshalling.
///
/// Returns the number of ships.
#[no_mangle]
pub extern "C" fn ft_match_new(seed_hi: u32, seed_lo: u32, scenario: u32) -> u32 {
    // Written out by hand rather than with format!, which would drag Rust's
    // whole formatting machinery into the module for sixteen characters. The
    // result is byte identical to the server's lowercase hex seed, so a match
    // started here and one started from that string are the same match.
    let mut hex = [0u8; 16];
    for (i, byte) in hex.iter_mut().enumerate() {
        let word = if i < 8 { seed_hi } else { seed_lo };
        let nibble = (word >> (28 - 4 * (i % 8))) & 0xf;
        *byte = if nibble < 10 { b'0' + nibble as u8 } else { b'a' + (nibble as u8 - 10) };
    }
    let seed = core::str::from_utf8(&hex).unwrap_or("0000000000000000");
    let sim = match scenario {
        1 => scenario_duel(seed),
        2 => scenario_convoy(seed),
        _ => scenario_skirmish(seed),
    };
    let n = sim.ships.len();
    unsafe {
        MATCH = Some(sim);
    }
    if let Some(s) = sim_opt() {
        s.record = true;
    }
    let o = orders();
    o.clear();
    o.resize(n, None);
    events().clear();
    n as u32
}

fn spec(class: crate::data::ShipClassId, p: (f32, f32, f32), f: (f32, f32, f32)) -> SpawnSpec {
    SpawnSpec { class, pos: V3::new(p.0, p.1, p.2), facing: V3::new(f.0, f.1, f.2) }
}

fn scenario_skirmish(seed: &str) -> Sim {
    use crate::data::ShipClassId::*;
    Sim::new_skirmish(
        seed,
        &[
            spec(TerranFrigate, (-40.0, 0.0, 0.0), (1.0, 0.0, 0.0)),
            spec(TerranFrigate, (-40.0, 5.0, -15.0), (1.0, 0.0, 0.0)),
        ],
        &[
            spec(KarisenFrigate, (40.0, 0.0, 5.0), (-1.0, 0.0, 0.0)),
            spec(RogueFrigate, (40.0, -4.0, -10.0), (-1.0, 0.0, 0.0)),
        ],
        Faction::Karisen,
    )
}

fn scenario_duel(seed: &str) -> Sim {
    use crate::data::ShipClassId::*;
    Sim::new_skirmish(
        seed,
        &[spec(TerranFrigate, (-30.0, 0.0, 0.0), (1.0, 0.0, 0.0))],
        &[spec(KarisenFrigate, (30.0, 0.0, 0.0), (-1.0, 0.0, 0.0))],
        Faction::Karisen,
    )
}

/// A freighter worth taking rather than killing, escorted by something that
/// objects. The boarding rules only bite when there is a hull worth boarding.
fn scenario_convoy(seed: &str) -> Sim {
    use crate::data::ShipClassId::*;
    Sim::new_skirmish(
        seed,
        &[
            spec(RogueFrigate, (-35.0, 0.0, -10.0), (1.0, 0.0, 0.0)),
            spec(TerranFrigate, (-35.0, 4.0, 10.0), (1.0, 0.0, 0.0)),
        ],
        &[
            spec(Freighter, (40.0, 0.0, 0.0), (-1.0, 0.0, 0.0)),
            spec(BenefactorFrigate, (30.0, -3.0, 18.0), (-1.0, 0.0, 0.0)),
        ],
        Faction::Benefactor,
    )
}

#[no_mangle]
pub extern "C" fn ft_ship_count() -> u32 {
    sim_opt().map(|s| s.ships.len() as u32).unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn ft_turn_index() -> i32 {
    sim_opt().map(|s| s.turn).unwrap_or(0)
}

/// -1 while the match is live, else the winner: 0 player, 1 enemy.
#[no_mangle]
pub extern "C" fn ft_game_over() -> i32 {
    match sim_opt().and_then(|s| s.game_over) {
        None => -1,
        Some(Winner::Player) => 0,
        Some(Winner::Enemy) => 1,
    }
}

/// The state hash, split because the boundary carries 32 bit values.
#[no_mangle]
pub extern "C" fn ft_hash_hi() -> u32 {
    sim_opt().map(|s| (s.hash_state() >> 32) as u32).unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn ft_hash_lo() -> u32 {
    sim_opt().map(|s| s.hash_state() as u32).unwrap_or(0)
}

/// Write every ship as a fixed 40 slot record from slot 64. Returns the count.
#[no_mangle]
pub extern "C" fn ft_read_ships() -> u32 {
    let Some(sim) = sim_opt() else { return 0 };
    let n = sim.ships.len();
    let s = scratch();
    for (i, ship) in sim.ships.iter().enumerate() {
        let b = OUT + i * SHIP_STRIDE;
        if b + SHIP_STRIDE > SCRATCH_LEN {
            return i as u32;
        }
        let cls = ship.class_def();
        s[b] = ship.id as f32;
        s[b + 1] = class_index(ship.class) as f32;
        s[b + 2] = ship.faction.index() as f32;
        s[b + 3] = ship.is_player as u32 as f32;
        s[b + 4] = ship.destroyed as u32 as f32;
        s[b + 5] = ship.hull;
        s[b + 6] = ship.hull_max;
        s[b + 7] = ship.marines as f32;
        s[b + 8] = ship.pos.x;
        s[b + 9] = ship.pos.y;
        s[b + 10] = ship.pos.z;
        s[b + 11] = ship.quat.x;
        s[b + 12] = ship.quat.y;
        s[b + 13] = ship.quat.z;
        s[b + 14] = ship.quat.w;
        s[b + 15] = ship.vel.x;
        s[b + 16] = ship.vel.y;
        s[b + 17] = ship.vel.z;
        s[b + 18] = ship.mode as u32 as f32;
        s[b + 19] = ship.drift_active as u32 as f32;
        s[b + 20] = ship.subs.len() as f32;
        for k in 0..3 {
            let (hp, dead) = match ship.subs.get(k) {
                Some(x) => (x.hp, x.dead as u32 as f32),
                None => (0.0, 1.0),
            };
            s[b + 21 + k * 2] = hp;
            s[b + 22 + k * 2] = dead;
        }
        s[b + 27] = ship.weapons.len() as f32;
        for k in 0..3 {
            s[b + 28 + k] = ship.weapons.get(k).map(|w| w.last_fired_turn as f32).unwrap_or(-99.0);
        }
        s[b + 31] = ship.boarding_parties.len() as f32;
        for k in 0..2 {
            let (f, c) = match ship.boarding_parties.get(k) {
                Some(p) => (p.faction.index() as f32, p.count as f32),
                None => (-1.0, 0.0),
            };
            s[b + 32 + k * 2] = f;
            s[b + 33 + k * 2] = c;
        }
        s[b + 36] = cls.radius;
        s[b + 37] = ship.flight.max_speed;
        s[b + 38] = ship.ai_target.map(|t| t as f32).unwrap_or(-1.0);
        s[b + 39] = cls.boarding_range;
    }
    n as u32
}

/// Flight stats for one ship, into the input slots the flight queries read.
/// Written there rather than somewhere new so a preview for a ship in the
/// match and a preview for a hypothetical one go through the same path.
#[no_mangle]
pub extern "C" fn ft_load_ship(ship: u32) -> u32 {
    let Some(sim) = sim_opt() else { return 0 };
    let Some(sh) = sim.ships.get(ship as usize) else { return 0 };
    let s = scratch();
    s[0] = sh.pos.x;
    s[1] = sh.pos.y;
    s[2] = sh.pos.z;
    s[3] = sh.vel.x;
    s[4] = sh.vel.y;
    s[5] = sh.vel.z;
    s[6] = sh.quat.x;
    s[7] = sh.quat.y;
    s[8] = sh.quat.z;
    s[9] = sh.quat.w;
    s[18] = sh.flight.yaw_rate;
    s[19] = sh.flight.pitch_rate;
    s[20] = sh.flight.accel_fwd;
    s[21] = sh.flight.accel_retro;
    s[22] = sh.flight.accel_lat;
    s[23] = sh.flight.max_speed;
    1
}

/// Retune one ship's flight envelope. The harness sliders drive this, and the
/// stats are in the state hash precisely so two clients flying different
/// envelopes cannot silently agree.
#[no_mangle]
pub extern "C" fn ft_set_flight(
    ship: u32,
    yaw: f32,
    pitch: f32,
    fwd: f32,
    retro: f32,
    lat: f32,
    max_speed: f32,
) -> u32 {
    let Some(sim) = sim_opt() else { return 0 };
    let Some(sh) = sim.ships.get_mut(ship as usize) else { return 0 };
    sh.flight = Flight {
        yaw_rate: yaw,
        pitch_rate: pitch,
        accel_fwd: fwd,
        accel_retro: retro,
        accel_lat: lat,
        max_speed,
    };
    1
}

// ---------------------------------------------------------------- orders --

#[no_mangle]
pub extern "C" fn ft_orders_clear() {
    for o in orders().iter_mut() {
        *o = None;
    }
}

#[allow(clippy::too_many_arguments)]
#[no_mangle]
pub extern "C" fn ft_set_move(
    ship: u32,
    mode: u32,
    has_target: u32,
    tx: f32,
    ty: f32,
    tz: f32,
    has_face: u32,
    fx: f32,
    fy: f32,
    fz: f32,
) -> u32 {
    let o = orders();
    let Some(slot) = o.get_mut(ship as usize) else { return 0 };
    let entry = slot.get_or_insert_with(Order::default);
    entry.mode = Some(Mode::from_u32(mode));
    entry.target = if has_target != 0 { Some(V3::new(tx, ty, tz)) } else { None };
    entry.face = if has_face != 0 { Some(V3::new(fx, fy, fz)) } else { None };
    1
}

/// Queue one shot. `target_sub` is negative for "aim at the hull".
#[no_mangle]
pub extern "C" fn ft_add_fire(
    ship: u32,
    weapon_index: u32,
    second: i32,
    target_ship: u32,
    target_sub: i32,
) -> u32 {
    let o = orders();
    let Some(slot) = o.get_mut(ship as usize) else { return 0 };
    let entry = slot.get_or_insert_with(Order::default);
    entry.weapons.push(FireOrder {
        weapon_index: weapon_index as usize,
        second,
        target_ship: target_ship as u16,
        target_sub: if target_sub < 0 { None } else { Some(target_sub as usize) },
    });
    1
}

/// Clear just the queued shots for one ship, so a player can rebuild a
/// timeline without losing the movement order they already set.
#[no_mangle]
pub extern "C" fn ft_clear_fire(ship: u32) -> u32 {
    let o = orders();
    let Some(Some(entry)) = o.get_mut(ship as usize) else { return 0 };
    entry.weapons.clear();
    1
}

/// `target` negative cancels a boarding order.
#[no_mangle]
pub extern "C" fn ft_set_board(ship: u32, target: i32) -> u32 {
    let o = orders();
    let Some(slot) = o.get_mut(ship as usize) else { return 0 };
    let entry = slot.get_or_insert_with(Order::default);
    entry.board = if target < 0 { None } else { Some(target as u16) };
    1
}

/// Resolve the turn. Returns the number of events, which are then read in
/// pages through `ft_read_events`.
#[no_mangle]
pub extern "C" fn ft_resolve_turn() -> u32 {
    let Some(sim) = sim_opt() else { return 0 };
    let o = orders();
    if o.len() < sim.ships.len() {
        o.resize(sim.ships.len(), None);
    }
    let res = sim.resolve_turn(o);
    let ev = events();
    *ev = res.events;
    ev.len() as u32
}

/// Read events `from..from+max` into the scratch buffer, 14 slots each.
/// Paged because a busy turn can produce more events than the buffer holds,
/// and silently truncating the tail would lose exactly the interesting part.
#[no_mangle]
pub extern "C" fn ft_read_events(from: u32, max: u32) -> u32 {
    let ev = events();
    let s = scratch();
    let cap = ((SCRATCH_LEN - OUT) / EVENT_STRIDE) as u32;
    let take = max.min(cap);
    let mut n = 0u32;
    for i in 0..take {
        let Some(e) = ev.get((from + i) as usize) else { break };
        let b = OUT + (n as usize) * EVENT_STRIDE;
        s[b] = e.kind as u32 as f32;
        s[b + 1] = e.tick as f32;
        s[b + 2] = e.ship as f32;
        s[b + 3] = e.other as f32;
        s[b + 4] = e.aux as f32;
        s[b + 5] = e.amount;
        s[b + 6] = e.pos.x;
        s[b + 7] = e.pos.y;
        s[b + 8] = e.pos.z;
        s[b + 9] = e.to.x;
        s[b + 10] = e.to.y;
        s[b + 11] = e.to.z;
        s[b + 12] = 0.0;
        s[b + 13] = 0.0;
        n += 1;
    }
    n
}

// -------------------------------------------------------------- playback --

/// Ship poses at one recorded tick, 8 slots each. This is what the scrubber
/// reads: the renderer never re-simulates to draw a frame, so a replay shows
/// what happened rather than what would happen if it ran again.
#[no_mangle]
pub extern "C" fn ft_read_poses(tick: u32) -> u32 {
    let Some(sim) = sim_opt() else { return 0 };
    let Some(frame) = sim.tracks.get(tick.min(TICKS_PER_TURN) as usize) else { return 0 };
    let s = scratch();
    for (i, (p, q, dead)) in frame.ships.iter().enumerate() {
        let b = OUT + i * POSE_STRIDE;
        if b + POSE_STRIDE > SCRATCH_LEN {
            return i as u32;
        }
        s[b] = i as f32;
        s[b + 1] = *dead as u32 as f32;
        s[b + 2] = p.x;
        s[b + 3] = p.y;
        s[b + 4] = p.z;
        s[b + 5] = q.x;
        s[b + 6] = q.y;
        s[b + 7] = q.z;
        s[b + 8] = q.w;
    }
    frame.ships.len() as u32
}

/// Projectiles at one recorded tick, 5 slots each, written after the poses.
#[no_mangle]
pub extern "C" fn ft_read_track_projectiles(tick: u32) -> u32 {
    let Some(sim) = sim_opt() else { return 0 };
    let Some(frame) = sim.tracks.get(tick.min(TICKS_PER_TURN) as usize) else { return 0 };
    let s = scratch();
    for (i, (id, kind, p)) in frame.projectiles.iter().enumerate() {
        let b = OUT + i * PROJ_STRIDE;
        if b + PROJ_STRIDE > SCRATCH_LEN {
            return i as u32;
        }
        s[b] = *id as f32;
        s[b + 1] = if *kind == ProjKind::Missile { 1.0 } else { 0.0 };
        s[b + 2] = p.x;
        s[b + 3] = p.y;
        s[b + 4] = p.z;
    }
    frame.projectiles.len() as u32
}

/// Preview a ship's turn without committing it: the same integrator the
/// resolver runs, from the ship's live state. Preview and execution are the
/// same code, which is the only way a drawn plan can be trusted.
#[no_mangle]
pub extern "C" fn ft_ship_preview(ship: u32, mode: u32, samples: u32) -> u32 {
    if ft_load_ship(ship) == 0 {
        return 0;
    }
    let stride = (TICKS_PER_TURN / samples.max(1)).max(1);
    ft_fly_turn(mode, TICKS_PER_TURN, stride)
}

/// One tick of a ship's plan, at the fixed tick rate. Used by the resolver's
/// sibling on the client: the ghost that shows where a ship WILL be.
#[no_mangle]
pub extern "C" fn ft_ship_pose_at(ship: u32, tick: u32) -> u32 {
    let Some(sim) = sim_opt() else { return 0 };
    let Some(sh) = sim.ships.get(ship as usize) else { return 0 };
    let s = scratch();
    let p = sh.pos_at_tick(tick as i32);
    let q = sh.quat_at_tick(tick as i32);
    s[32] = p.x;
    s[33] = p.y;
    s[34] = p.z;
    s[38] = q.x;
    s[39] = q.y;
    s[40] = q.z;
    s[41] = q.w;
    1
}

/// Fly a ship's remaining turn from an arbitrary tick, used by nothing on the
/// client yet but exercised by tests: it is the shape a mid turn re-plan takes
/// and it belongs at the boundary rather than in a test only build.
#[no_mangle]
pub extern "C" fn ft_ship_fly_from(ship: u32, mode: u32, from_tick: u32) -> u32 {
    let Some(sim) = sim_opt() else { return 0 };
    let Some(sh) = sim.ships.get(ship as usize) else { return 0 };
    let steps = (TICKS_PER_TURN - from_tick.min(TICKS_PER_TURN)).max(1);
    let flown = fly_span(
        sh.body(),
        sh.plan_target,
        Mode::from_u32(mode),
        &sh.flight,
        sh.plan_face,
        steps,
        1.0 / TICKS_PER_SECOND as f32,
    );
    let s = scratch();
    s[32] = flown.end_pos.x;
    s[33] = flown.end_pos.y;
    s[34] = flown.end_pos.z;
    s[35] = flown.end_vel.x;
    s[36] = flown.end_vel.y;
    s[37] = flown.end_vel.z;
    1
}

/// Class metadata the client draws from: hull, radius, mass, boarding range,
/// marine complement, mount count and the default flight envelope.
#[no_mangle]
pub extern "C" fn ft_read_class(index: u32) -> u32 {
    let cls = ship_class(class_from_index(index));
    let s = scratch();
    s[OUT] = cls.hull;
    s[OUT + 1] = cls.radius;
    s[OUT + 2] = cls.mass;
    s[OUT + 3] = cls.boarding_range;
    s[OUT + 4] = cls.marines as f32;
    s[OUT + 5] = cls.boarding_capacity as f32;
    s[OUT + 6] = cls.weapons.len() as f32;
    s[OUT + 7] = cls.subsystems.len() as f32;
    s[OUT + 8] = cls.flight.yaw_rate;
    s[OUT + 9] = cls.flight.pitch_rate;
    s[OUT + 10] = cls.flight.accel_fwd;
    s[OUT + 11] = cls.flight.accel_retro;
    s[OUT + 12] = cls.flight.accel_lat;
    s[OUT + 13] = cls.flight.max_speed;
    1
}

/// One weapon mount: which weapon it carries and what that weapon can do.
#[no_mangle]
pub extern "C" fn ft_read_mount(class_idx: u32, mount: u32) -> u32 {
    let cls = ship_class(class_from_index(class_idx));
    let Some(m) = cls.weapons.get(mount as usize) else { return 0 };
    let wd = crate::data::weapon(m.key);
    let s = scratch();
    s[OUT] = m.key as u32 as f32;
    s[OUT + 1] = wd.kind as u32 as f32;
    s[OUT + 2] = wd.damage();
    s[OUT + 3] = wd.range;
    s[OUT + 4] = wd.cooldown_turns as f32;
    s[OUT + 5] = wd.arc_h.0;
    s[OUT + 6] = wd.arc_h.1;
    s[OUT + 7] = wd.arc_v.0;
    s[OUT + 8] = wd.arc_v.1;
    s[OUT + 9] = wd.batch as f32;
    s[OUT + 10] = m.mount.x;
    s[OUT + 11] = m.mount.y;
    s[OUT + 12] = m.mount.z;
    1
}

/// A ship's nominal reach: roughly how far it covers in a turn from rest.
///
/// Not a movement rule, and not what the envelope is made of. The integrator
/// decides where a ship can go and the client probes it cell by cell; this
/// only says how big a box is worth probing. Exposed rather than recomputed on
/// the client so the box, the AI's engagement distances and the flight stats
/// all come from one number instead of two that can drift apart.
#[no_mangle]
pub extern "C" fn ft_nominal_reach(ship: u32) -> f32 {
    sim_opt()
        .and_then(|s| s.ships.get(ship as usize))
        .map(|sh| sh.flight.nominal_reach())
        .unwrap_or(0.0)
}
