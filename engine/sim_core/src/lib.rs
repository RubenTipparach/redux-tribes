//! Fallen Tribes simulation core.
//!
//! Engine agnostic and I/O free by construction (ADR-2): no rendering, no
//! networking, no filesystem, no clock. Orders and state go in, state and
//! events come out, and the same crate serves a TypeScript client through
//! `ffi` compiled to wasm32 and a future native Rust client as an rlib.

pub mod ffi;
pub mod flight;
pub mod math;

pub use flight::{can_reach, fly_turn, Body, Flight, Flown, Mode};
pub use math::{Quat, V3};
