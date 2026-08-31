//! Fallen Tribes simulation core.
//!
//! Engine agnostic and I/O free by construction (ADR-2): no rendering, no
//! networking, no filesystem, no clock. Orders and state go in, state and
//! events come out, and the same crate serves a TypeScript client through
//! `ffi` compiled to wasm32 and a future native Rust client as an rlib.

pub mod ai;
pub mod data;
pub mod design;
pub mod ffi;
pub mod flight;
pub mod math;
pub mod rng;
pub mod snapshot;
pub mod state;
pub mod turn;

pub use flight::{can_reach, fly_turn, gravity_at, Body, Flight, Flown, Mode, Well};
pub use math::{Quat, V3};
