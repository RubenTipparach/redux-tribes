//! The design derivation, pinned against the editor's own numbers.
//!
//! These are calibration, not arithmetic: the five authored classes are what
//! the whole parts table was fitted to, so a change that moves any of them has
//! moved the game and should have to say so out loud. The fixtures below were
//! generated from `web/src/app/design.ts` at the commit that moved the
//! arithmetic here, and a client asking the core for its readout must get the
//! same ship the editor used to compute for itself.

use sim_core::data::ShipClassId;
use sim_core::design::{derive, Geometry};
use std::sync::{Mutex, MutexGuard};

/// The hull registry behind `ft_hull_design` is one static per side, because
/// the boundary is single threaded by construction (one scratch buffer, one
/// match). Cargo is not: two tests fielding a design at once leave one of them
/// reading the other's ship, which failed as "a designed hull carries its own
/// hull: 180" long after the test that caused it had passed.
static BOUNDARY: Mutex<()> = Mutex::new(());
fn alone() -> MutexGuard<'static, ()> {
    BOUNDARY.lock().unwrap_or_else(|e| e.into_inner())
}

struct Expect {
    mass: f32,
    hull: f32,
    radius: f32,
    accel_fwd: f32,
    accel_retro: f32,
    accel_lat: f32,
    max_speed: f32,
    yaw: f32,
    pitch: f32,
    reach_u: f32,
    marines: i32,
    capacity: i32,
    boarding_range: f32,
    legal: bool,
}

/// Close enough to be the same ship: the editor computes in f64 and the core in
/// f32, so the last places differ and nothing else may.
fn near(a: f32, b: f32, what: &str) {
    let tol = b.abs().max(1.0) * 2.0e-5;
    assert!((a - b).abs() <= tol, "{what}: core {a} against editor {b}");
}

#[test]
fn every_authored_class_derives_exactly_as_the_editor_does() {
    let cases: &[(ShipClassId, &[usize], Geometry, Expect)] = &[
        (ShipClassId::TerranFrigate,
         &[1, 1, 1, 1, 1, 1, 12, 12, 12, 13, 13, 13, 7, 7, 10, 10, 11, 11, 16, 17, 17, 17, 18, 18, 18, 18, 19, 19],
         Geometry { plate_cells: 6066, ext: [32, 14, 58], radius_cells: 30.099833886584822, fouled: 0 },
         Expect { mass: 0.5128639936447144, hull: 121.3010025024414, radius: 1.6460846662521362, accel_fwd: 1.754851222038269, accel_retro: 0.5849503874778748, accel_lat: 0.3899669349193573, max_speed: 8.0, yaw: 11.161123275756836, pitch: 7.47795295715332, reach_u: 61.764835357666016, marines: 15, capacity: 8, boarding_range: 20.0, legal: true }),
        (ShipClassId::KarisenFrigate,
         &[2, 2, 2, 0, 12, 13, 15, 7, 7, 10, 10, 11, 11, 16, 17, 17, 17, 18, 18, 12, 13, 19, 19],
         Geometry { plate_cells: 4908, ext: [19, 17, 61], radius_cells: 31.44439536706025, fouled: 0 },
         Expect { mass: 0.47345298528671265, hull: 110.45899963378906, radius: 1.7196153402328491, accel_fwd: 2.006535053253174, accel_retro: 0.6336426138877869, accel_lat: 0.4224283993244171, max_speed: 8.5, yaw: 11.495593070983887, pitch: 7.702047824859619, reach_u: 66.99632263183594, marines: 15, capacity: 4, boarding_range: 20.0, legal: true }),
        (ShipClassId::RogueFrigate,
         &[3, 3, 3, 12, 12, 14, 14, 7, 7, 6, 10, 10, 8, 8, 11, 11, 16, 17, 17, 17, 17, 17, 17, 17, 17, 18, 18, 18, 18, 18, 18, 19, 19, 19, 19, 19, 19],
         Geometry { plate_cells: 1927, ext: [32, 12, 47], radius_cells: 24.904818810824544, fouled: 0 },
         Expect { mass: 0.6807479858398438, hull: 147.5500030517578, radius: 1.3619823455810547, accel_fwd: 1.4542826414108276, accel_retro: 0.5141403079032898, accel_lat: 0.3525533676147461, max_speed: 9.5, yaw: 12.451886177062988, pitch: 8.34276294708252, reach_u: 63.97095489501953, marines: 40, capacity: 12, boarding_range: 40.0, legal: true }),
        (ShipClassId::BenefactorFrigate,
         &[5, 0, 0, 1, 12, 12, 14, 14, 15, 7, 7, 10, 10, 11, 11, 16, 17, 17, 17, 18, 18, 18, 18, 19, 19],
         Geometry { plate_cells: 4397, ext: [20, 24, 57], radius_cells: 29.415132160165456, fouled: 0 },
         Expect { mass: 0.49393099546432495, hull: 113.64700317382812, radius: 1.6086400747299194, accel_fwd: 1.7208881378173828, accel_retro: 0.6073722839355469, accel_lat: 0.40491485595703125, max_speed: 8.0, yaw: 11.792257308959961, pitch: 7.900813102722168, reach_u: 61.40495300292969, marines: 15, capacity: 8, boarding_range: 20.0, legal: true }),
        (ShipClassId::Freighter,
         &[4, 4, 4, 7, 7, 9, 9, 9, 9, 16, 20, 20, 17, 17, 17, 18, 18, 18],
         Geometry { plate_cells: 27676, ext: [28, 26, 93], radius_cells: 47.563115961845895, fouled: 0 },
         Expect { mass: 0.9067209959030151, hull: 251.7030029296875, radius: 2.6011078357696533, accel_fwd: 0.9925875663757324, accel_retro: 0.33086252212524414, accel_lat: 0.2205750197172165, max_speed: 5.0, yaw: 3.937145471572876, pitch: 2.637887716293335, reach_u: 37.406654357910156, marines: 15, capacity: 6, boarding_range: 10.0, legal: true }),
        (ShipClassId::TerranCorvette,
         &[2, 1, 12, 13, 12, 13, 7, 7, 9, 9, 16, 17, 18, 19, 19],
         Geometry { plate_cells: 2266, ext: [20, 11, 43], radius_cells: 22.594247055390007, fouled: 0 },
         Expect { mass: 0.302154004573822, hull: 68.59100341796875, radius: 1.2356228828430176, accel_fwd: 1.4893068075180054, accel_retro: 0.9928711652755737, accel_lat: 0.3309570550918579, max_speed: 8.5, yaw: 12.776481628417969, pitch: 8.560243606567383, reach_u: 60.743751525878906, marines: 5, capacity: 2, boarding_range: 20.0, legal: true }),
        (ShipClassId::TerranDestroyer,
         &[5, 5, 5, 0, 0, 0, 12, 13, 12, 13, 12, 13, 12, 13, 12, 14, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 11, 11, 16, 17, 17, 17, 17, 17, 18, 18, 18, 18, 18, 19, 19],
         Geometry { plate_cells: 21504, ext: [44, 25, 84], radius_cells: 43.55743334954437, fouled: 0 },
         Expect { mass: 1.002344012260437, hull: 258.2720031738281, radius: 2.382047176361084, accel_fwd: 1.9454399347305298, accel_retro: 0.5985968708992004, accel_lat: 0.3990646004676819, max_speed: 7.0, yaw: 7.8862762451171875, pitch: 5.2838053703308105, reach_u: 57.40644836425781, marines: 25, capacity: 10, boarding_range: 20.0, legal: true }),
        (ShipClassId::TerranCruiser,
         &[5, 5, 5, 5, 0, 0, 0, 0, 12, 13, 12, 13, 12, 13, 12, 13, 12, 13, 12, 13, 12, 14, 12, 14, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 11, 11, 16, 17, 17, 17, 17, 17, 17, 17, 17, 18, 18, 18, 18, 18, 18, 19, 19, 19, 19],
         Geometry { plate_cells: 65415, ext: [54, 31, 111], radius_cells: 57.66714836022326, fouled: 0 },
         Expect { mass: 1.7842559814453125, hull: 519.3740234375, radius: 3.153672218322754, accel_fwd: 1.4571900367736816, accel_retro: 0.3362746238708496, accel_lat: 0.2241830825805664, max_speed: 7.0, yaw: 3.3526477813720703, pitch: 2.24627423286438, reach_u: 53.18681716918945, marines: 40, capacity: 12, boarding_range: 30.0, legal: true }),
        (ShipClassId::KarisenCorvette,
         &[3, 3, 3, 12, 13, 15, 6, 6, 9, 9, 16, 17, 18, 19, 19],
         Geometry { plate_cells: 1918, ext: [12, 15, 48], radius_cells: 25.636887486588538, fouled: 0 },
         Expect { mass: 0.31320101022720337, hull: 70.1520004272461, radius: 1.4020172357559204, accel_fwd: 3.160909414291382, accel_retro: 0.31928378343582153, accel_lat: 0.31928378343582153, max_speed: 9.5, yaw: 11.04189682006836, pitch: 7.398071765899658, reach_u: 80.72404479980469, marines: 5, capacity: 2, boarding_range: 20.0, legal: true }),
        (ShipClassId::KarisenDestroyer,
         &[2, 2, 2, 0, 12, 13, 12, 13, 15, 15, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 11, 11, 16, 17, 17, 17, 17, 18, 18, 18, 19, 19],
         Geometry { plate_cells: 19485, ext: [24, 25, 92], radius_cells: 46.82146943443787, fouled: 0 },
         Expect { mass: 0.7284389734268188, hull: 196.17100524902344, radius: 2.560549020767212, accel_fwd: 1.3041585683822632, accel_retro: 0.8236791491508484, accel_lat: 0.5491194128990173, max_speed: 8.5, yaw: 9.908023834228516, pitch: 6.638376712799072, reach_u: 57.300148010253906, marines: 20, capacity: 6, boarding_range: 20.0, legal: true }),
        (ShipClassId::KarisenCruiser,
         &[5, 5, 2, 2, 0, 12, 13, 12, 13, 15, 15, 15, 15, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 11, 11, 16, 17, 17, 17, 17, 17, 18, 18, 18, 19, 19],
         Geometry { plate_cells: 45744, ext: [32, 33, 123], radius_cells: 62.99603162104737, fouled: 0 },
         Expect { mass: 1.1841540336608887, hull: 349.81201171875, radius: 3.4450955390930176, accel_fwd: 1.562296748161316, accel_retro: 0.5066908597946167, accel_lat: 0.33779391646385193, max_speed: 8.5, yaw: 4.558844566345215, pitch: 3.0544261932373047, reach_u: 61.876991271972656, marines: 25, capacity: 6, boarding_range: 20.0, legal: true }),
        (ShipClassId::RogueCorvette,
         &[3, 3, 0, 12, 14, 6, 6, 9, 9, 16, 17, 17, 17, 18, 18, 19, 19],
         Geometry { plate_cells: 943, ext: [24, 11, 36], radius_cells: 18.848076824970764, fouled: 0 },
         Expect { mass: 0.30559399724006653, hull: 66.40799713134766, radius: 1.0307542085647583, accel_fwd: 2.3233439922332764, accel_retro: 0.3272315561771393, accel_lat: 0.3272315561771393, max_speed: 9.5, yaw: 15.089011192321777, pitch: 10.109638214111328, reach_u: 75.57756042480469, marines: 15, capacity: 4, boarding_range: 20.0, legal: true }),
        (ShipClassId::RogueDestroyer,
         &[3, 3, 3, 12, 14, 12, 14, 12, 14, 7, 7, 7, 7, 10, 10, 8, 8, 11, 11, 8, 8, 16, 17, 17, 17, 17, 17, 17, 17, 17, 17, 18, 18, 18, 18, 18, 18, 18, 19, 19, 19, 19, 19, 19],
         Geometry { plate_cells: 8888, ext: [48, 19, 70], radius_cells: 36.07284297085551, fouled: 0 },
         Expect { mass: 0.8571079969406128, hull: 199.9739990234375, radius: 1.972733497619629, accel_fwd: 1.1550469398498535, accel_retro: 0.7000284790992737, accel_lat: 0.32667994499206543, max_speed: 9.5, yaw: 7.746982097625732, pitch: 5.190478324890137, reach_u: 55.93231964111328, marines: 45, capacity: 14, boarding_range: 40.0, legal: true }),
        (ShipClassId::RogueCruiser,
         &[3, 3, 3, 3, 12, 14, 12, 14, 12, 14, 12, 14, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 11, 11, 16, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 18, 18, 18, 18, 18, 18, 18, 18, 19, 19, 19, 19, 19, 19, 19, 19],
         Geometry { plate_cells: 22640, ext: [64, 24, 91], radius_cells: 47.64714052280577, fouled: 0 },
         Expect { mass: 1.279420018196106, hull: 319.1000061035156, radius: 2.6057028770446777, accel_fwd: 1.0317175388336182, accel_retro: 0.46896249055862427, accel_lat: 0.3126416802406311, max_speed: 9.5, yaw: 5.703133583068848, pitch: 3.8210997581481934, reach_u: 51.26225280761719, marines: 70, capacity: 16, boarding_range: 50.0, legal: true }),
        (ShipClassId::BenefactorCorvette,
         &[1, 0, 0, 12, 14, 15, 7, 7, 9, 8, 16, 17, 18, 19, 19],
         Geometry { plate_cells: 1846, ext: [18, 19, 40], radius_cells: 20.524375751773793, fouled: 0 },
         Expect { mass: 0.2598690092563629, hull: 58.76599884033203, radius: 1.1224267482757568, accel_fwd: 0.9620231986045837, accel_retro: 1.1544277667999268, accel_lat: 0.2693665027618408, max_speed: 8.0, yaw: 11.178709983825684, pitch: 7.4897356033325195, reach_u: 46.73676681518555, marines: 5, capacity: 2, boarding_range: 20.0, legal: true }),
        (ShipClassId::BenefactorDestroyer,
         &[5, 5, 0, 0, 12, 14, 12, 14, 12, 14, 15, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 11, 11, 16, 17, 17, 17, 17, 17, 18, 18, 18, 18, 18, 19, 19],
         Geometry { plate_cells: 21454, ext: [30, 36, 81], radius_cells: 41.68033109273485, fouled: 0 },
         Expect { mass: 0.8741769790649414, hull: 231.17999267578125, radius: 2.279393196105957, accel_fwd: 1.4871129989624023, accel_retro: 0.6863598823547363, accel_lat: 0.4575732350349426, max_speed: 7.0, yaw: 9.377427101135254, pitch: 6.282876491546631, reach_u: 53.525123596191406, marines: 25, capacity: 10, boarding_range: 20.0, legal: true }),
        (ShipClassId::BenefactorCruiser,
         &[5, 5, 5, 0, 0, 12, 14, 12, 14, 12, 14, 12, 14, 15, 15, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 11, 11, 16, 17, 17, 17, 17, 17, 17, 17, 18, 18, 18, 18, 18, 18, 19, 19, 19, 19],
         Geometry { plate_cells: 53239, ext: [40, 46, 107], radius_cells: 56.037933580745104, fouled: 0 },
         Expect { mass: 1.4411499500274658, hull: 420.385986328125, radius: 3.0645744800567627, accel_fwd: 1.3183915615081787, accel_retro: 0.4163341820240021, accel_lat: 0.2775561213493347, max_speed: 7.0, yaw: 4.306010723114014, pitch: 2.8850274085998535, reach_u: 51.416751861572266, marines: 35, capacity: 12, boarding_range: 30.0, legal: true }),
        (ShipClassId::CivilLighter,
         &[4, 4, 7, 7, 9, 9, 9, 9, 16, 17, 18, 18, 23, 23],
         Geometry { plate_cells: 10520, ext: [28, 36, 60], radius_cells: 32.17141588429082, fouled: 0 },
         Expect { mass: 0.43773001432418823, hull: 115.2699966430664, radius: 1.7593743801116943, accel_fwd: 1.3707079887390137, accel_retro: 0.6853539943695068, accel_lat: 0.4569026529788971, max_speed: 5.0, yaw: 12.640973091125488, pitch: 8.469452857971191, reach_u: 40.88062286376953, marines: 5, capacity: 4, boarding_range: 10.0, legal: true }),
        (ShipClassId::CivilHauler,
         &[4, 4, 4, 7, 7, 7, 7, 9, 9, 9, 9, 9, 9, 16, 17, 17, 22, 18, 18, 18, 19, 19, 23, 23, 23, 23, 23, 23],
         Geometry { plate_cells: 20741, ext: [28, 36, 80], radius_cells: 41.6293165929973, fouled: 0 },
         Expect { mass: 1.047724962234497, hull: 266.14898681640625, radius: 2.2766032218933105, accel_fwd: 0.859004020690918, accel_retro: 0.5726693272590637, accel_lat: 0.28633466362953186, max_speed: 5.0, yaw: 5.9414448738098145, pitch: 3.9807686805725098, reach_u: 35.448265075683594, marines: 10, capacity: 6, boarding_range: 20.0, legal: true }),
        (ShipClassId::CivilBoxship,
         &[5, 5, 5, 4, 4, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 11, 11, 16, 17, 17, 22, 18, 18, 18, 19, 19, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23],
         Geometry { plate_cells: 50260, ext: [36, 49, 113], radius_cells: 58.78350108661443, fouled: 0 },
         Expect { mass: 2.057914972305298, hull: 543.6849975585938, radius: 3.2147226333618164, accel_fwd: 1.1662288904190063, accel_retro: 0.2915572226047516, accel_lat: 0.19437149167060852, max_speed: 7.0, yaw: 2.8553688526153564, pitch: 1.9130972623825073, reach_u: 48.99211883544922, marines: 10, capacity: 6, boarding_range: 20.0, legal: true }),
        (ShipClassId::CivilTanker,
         &[5, 5, 5, 4, 4, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 16, 17, 17, 18, 18, 24, 24, 24, 24, 24, 24],
         Geometry { plate_cells: 52826, ext: [36, 38, 107], radius_cells: 54.94770240874499, fouled: 0 },
         Expect { mass: 1.813323974609375, hull: 497.83099365234375, radius: 3.0049526691436768, accel_fwd: 1.3235362768173218, accel_retro: 0.33088406920433044, accel_lat: 0.11029468476772308, max_speed: 7.0, yaw: 3.422227621078491, pitch: 1.1464463472366333, reach_u: 51.488983154296875, marines: 10, capacity: 4, boarding_range: 10.0, legal: true }),
        (ShipClassId::CivilMiner,
         &[4, 4, 7, 7, 7, 7, 9, 9, 9, 9, 9, 9, 12, 27, 12, 27, 16, 17, 17, 18, 18, 19, 19, 25, 25, 25, 25],
         Geometry { plate_cells: 15715, ext: [40, 31, 71], radius_cells: 36.5991803186902, fouled: 0 },
         Expect { mass: 1.1169010400772095, hull: 269.66900634765625, radius: 2.0015177726745605, accel_fwd: 0.5372006893157959, accel_retro: 0.5372006893157959, accel_lat: 0.26860034465789795, max_speed: 5.0, yaw: 6.279951572418213, pitch: 4.207568168640137, reach_u: 26.731229782104492, marines: 10, capacity: 4, boarding_range: 20.0, legal: true }),
        (ShipClassId::CivilLiner,
         &[5, 5, 5, 1, 1, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 11, 11, 16, 26, 26, 26, 26, 26, 26, 26, 26, 22, 22, 18, 18, 19, 19, 23, 23],
         Geometry { plate_cells: 50800, ext: [36, 44, 117], radius_cells: 60.201744160779924, fouled: 0 },
         Expect { mass: 1.6632299423217773, hull: 461.7799987792969, radius: 3.292282819747925, accel_fwd: 1.262603521347046, accel_retro: 0.36074385046958923, accel_lat: 0.24049590528011322, max_speed: 8.0, yaw: 3.4121642112731934, pitch: 2.2861502170562744, reach_u: 54.655540466308594, marines: 16, capacity: 4, boarding_range: 20.0, legal: true }),
    ];

    // Every class, not a list of classes. The name says "every" and the loop
    // reads a hand written table, so the eighteenth class would be absent
    // exactly as the sixth was and this would pass without deriving it.
    assert_eq!(cases.len(), sim_core::data::ALL_CLASSES.len(),
        "a class was added without a derivation fixture");
    for (class, parts, geo, want) in cases {
        let got = derive(*class, parts, *geo);
        let key = sim_core::data::ship_class(*class).key;
        near(got.mass, want.mass, &format!("{key} mass"));
        near(got.hull, want.hull, &format!("{key} hull"));
        near(got.radius, want.radius, &format!("{key} radius"));
        near(got.accel_fwd, want.accel_fwd, &format!("{key} accel fwd"));
        near(got.accel_retro, want.accel_retro, &format!("{key} accel retro"));
        near(got.accel_lat, want.accel_lat, &format!("{key} accel lat"));
        near(got.max_speed, want.max_speed, &format!("{key} max speed"));
        near(got.yaw_rate, want.yaw, &format!("{key} yaw"));
        near(got.pitch_rate, want.pitch, &format!("{key} pitch"));
        near(got.reach_u, want.reach_u, &format!("{key} reach"));
        assert_eq!(got.marines, want.marines, "{key} marines");
        assert_eq!(got.capacity, want.capacity, "{key} capacity");
        near(got.boarding_range, want.boarding_range, &format!("{key} boarding range"));
        assert_eq!(got.legal(), want.legal, "{key} legality");
    }
}

#[test]
fn the_gates_fail_one_at_a_time() {
    use sim_core::design::{CHECK_ARMS, CHECK_BRIDGE, CHECK_MASS, CHECK_PARTS, CHECK_SPHERE,
        CHECK_THRUST, CHECK_TURRETS};
    let terran = ShipClassId::TerranFrigate;
    let geo = Geometry { plate_cells: 4825, ext: [22, 14, 58], radius_cells: 30.0998, fouled: 0 };
    let full: &[usize] = &[1, 1, 1, 1, 1, 1, 12, 12, 12, 13, 13, 13, 7, 7, 10, 10, 11, 11, 16,
        17, 17, 17, 18, 18, 18, 18, 19, 19];

    assert!(derive(terran, full, geo).legal());
    // Nothing fitted at all fails four gates at once, which is what an empty
    // frame IS: no parts, no drive, no bridge, no guns.
    let empty = derive(terran, &[], Geometry { fouled: 0, ..Default::default() });
    assert_eq!(empty.gates & CHECK_PARTS, 0);
    assert_eq!(empty.gates & CHECK_THRUST, 0);
    assert_eq!(empty.gates & CHECK_BRIDGE, 0);
    assert_eq!(empty.gates & CHECK_ARMS, 0);
    assert_ne!(empty.gates & CHECK_MASS, 0, "an empty frame is inside its berth");

    // A hull with a bridge and nothing else keeps the bridge gate and loses
    // the rest, so the gates are separate rather than one verdict wearing
    // seven labels.
    let bare = derive(terran, &[16], Geometry { fouled: 0, ..Default::default() });
    assert_ne!(bare.gates & CHECK_BRIDGE, 0);
    assert_eq!(bare.gates & CHECK_THRUST, 0);

    // Over the berth, and over the sphere, each on their own.
    let heavy = derive(terran, full, Geometry { plate_cells: 40_000, ..geo });
    assert_eq!(heavy.gates & CHECK_MASS, 0, "20 times the plate is over the berth");
    let wide = derive(terran, full, Geometry { radius_cells: 90.0, ..geo });
    assert_eq!(wide.gates & CHECK_SPHERE, 0, "a hull past its class radius is illegal");

    // And a turret with something standing in it.
    let fouled = derive(terran, full, Geometry { fouled: 3, ..geo });
    assert_eq!(fouled.gates & CHECK_TURRETS, 0);
    assert!(!fouled.legal());
}

#[test]
fn a_freighter_needs_no_guns_and_everything_else_does() {
    use sim_core::design::CHECK_ARMS;
    let geo = Geometry { plate_cells: 100, ext: [8, 8, 20], radius_cells: 12.0, fouled: 0 };
    // The Freighter frame has no gun ring at all, so "at least one gun" is a
    // gate it cannot ever pass and must not be asked to.
    let f = derive(ShipClassId::Freighter, &[4, 16], geo);
    assert_ne!(f.gates & CHECK_ARMS, 0);
    let t = derive(ShipClassId::TerranFrigate, &[1, 16], geo);
    assert_eq!(t.gates & CHECK_ARMS, 0, "a frigate with no gun is not a warship");
}

#[test]
fn a_designed_hull_flies_and_fights_as_itself() {
    // The whole point of deriving in the core: what a design comes out as has
    // to reach the ships in the match, not just the readout in the editor.
    use sim_core::ffi::{ft_hull_clear, ft_hull_design, ft_hull_mount, ft_match_new,
        ft_read_ships, ft_scratch_ptr, DERIVE_PARTS, SHIP_STRIDE};
    const OUT: usize = 64;
    let _lock = alone();

    let read = || {
        let n = ft_read_ships() as usize;
        let s = unsafe { core::slice::from_raw_parts(ft_scratch_ptr(), 16384) };
        (0..n)
            .map(|i| {
                let b = OUT + i * SHIP_STRIDE;
                (s[b + 3] as u32, s[b + 5], s[b + 7] as i32, s[b + 35], s[b + 21] as i32)
            })
            .collect::<Vec<_>>()   // side, hull, marines, radius, mounts
    };

    ft_hull_clear(0);
    ft_hull_clear(1);
    ft_match_new(0xdead_beef, 0xcafe_0002, 0, 0b01);
    let stock = read();
    let mine = stock.iter().find(|(side, ..)| *side == 0).copied().unwrap();

    // A Rogue built out of the parts the stock Rogue carries, flown by side 0.
    let parts: &[usize] = &[3, 3, 3, 12, 12, 14, 14, 7, 7, 6, 10, 10, 8, 8, 11, 11, 16,
        17, 17, 17, 17, 17, 17, 17, 17, 18, 18, 18, 18, 18, 18, 19, 19, 19, 19, 19, 19];
    {
        let s = unsafe { core::slice::from_raw_parts_mut(ft_scratch_ptr(), 16384) };
        for (i, p) in parts.iter().enumerate() {
            s[DERIVE_PARTS + i] = *p as f32;
        }
    }
    assert_eq!(ft_hull_design(0, 0, 2, 1632, 24, 14, 45, 24.315633, 0, parts.len() as u32), 1);
    // Two plasma up front, which the class does not carry.
    ft_hull_mount(0, 0, 2, -0.8, 0.2, 1.5, 0);
    ft_hull_mount(0, 0, 2, 0.8, 0.2, 1.5, 0);

    ft_match_new(0xdead_beef, 0xcafe_0002, 0, 0b01);
    let flown = read();
    // Slot 0, so the FIRST hull this side fields and no other. A design is a
    // ship, not a uniform: swapping one out of a pair must leave the one
    // beside it exactly as the scenario authored it.
    let ours: Vec<_> = flown.iter().filter(|(side, ..)| *side == 0).copied().collect();
    let (_, hull, marines, radius, mounts) = ours[0];
    assert!((hull - 146.296).abs() < 0.1, "a designed hull carries its own hull: {hull}");
    assert_eq!(marines, 40, "and its own marines");
    assert!((radius - 1.32976).abs() < 0.01, "and its own radius: {radius}");
    assert_eq!(mounts, 2, "and the guns it was built with");
    let stock_ours: Vec<_> = stock.iter().filter(|(side, ..)| *side == 0).copied().collect();
    assert!(ours.len() >= 2, "the skirmish seats two, or the next line proves nothing");
    assert_eq!(ours[1], stock_ours[1], "the ship beside it is untouched");
    assert_ne!(flown[0].1, mine.1, "the design changed the ship it was applied to");

    // The other side is untouched, and clearing puts everything back.
    let foe_stock = stock.iter().find(|(side, ..)| *side == 1).copied().unwrap();
    let foe_now = flown.iter().find(|(side, ..)| *side == 1).copied().unwrap();
    assert_eq!(foe_stock, foe_now, "a design is one side's, not the match's");

    ft_hull_clear(0);
    ft_match_new(0xdead_beef, 0xcafe_0002, 0, 0b01);
    assert_eq!(read(), stock, "clearing the design restores the authored ships");
}

#[test]
fn an_illegal_hull_is_not_fielded() {
    // The gates are the core's, so the refusal is too. A client deciding for
    // itself which of its designs were allowed into a match is the client that
    // lets one through.
    use sim_core::ffi::{ft_hull_clear, ft_hull_design, ft_match_new, ft_read_ships,
        ft_scratch_ptr, DERIVE_PARTS, SHIP_STRIDE};
    const OUT: usize = 64;
    let _lock = alone();
    let hulls = || {
        let n = ft_read_ships() as usize;
        let s = unsafe { core::slice::from_raw_parts(ft_scratch_ptr(), 16384) };
        (0..n).map(|i| s[OUT + i * SHIP_STRIDE + 6]).collect::<Vec<_>>()
    };

    ft_hull_clear(0);
    ft_hull_clear(1);
    ft_match_new(0xdead_beef, 0xcafe_0003, 0, 0b01);
    let stock = hulls();

    // A frame with a bridge and nothing else: no drive, no guns.
    {
        let s = unsafe { core::slice::from_raw_parts_mut(ft_scratch_ptr(), 16384) };
        s[DERIVE_PARTS] = 16.0;
    }
    assert_eq!(ft_hull_design(0, 0, 0, 10, 4, 4, 8, 5.0, 0, 1), 0, "an illegal hull is refused");
    ft_match_new(0xdead_beef, 0xcafe_0003, 0, 0b01);
    assert_eq!(hulls(), stock, "and the match is flown in the authored hulls");
}

#[test]
fn a_scenario_says_what_it_fields_before_anybody_picks() {
    // The lobby offers a hull per SHIP, so it has to know which ships a
    // scenario seats before it starts one. Asked of the core rather than
    // listed a second time in the client: a second list is a list that goes
    // out of step the first time a scenario is retuned, and it would be the
    // one the player was reading.
    use sim_core::ffi::{ft_hull_clear, ft_hull_choice, ft_scenario_roster, ft_scratch_ptr};
    let _lock = alone();
    ft_hull_clear(0);
    ft_hull_clear(1);

    let read = |scenario: u32| {
        let n = ft_scenario_roster(scenario) as usize;
        let s = unsafe { core::slice::from_raw_parts(ft_scratch_ptr(), 16384) };
        (0..n).map(|i| (s[64 + i * 2] as u32, s[64 + i * 2 + 1] as u32)).collect::<Vec<_>>()
    };

    // The duel is one a side; the skirmish is two.
    let duel = read(1);
    assert_eq!(duel.len(), 2, "the duel seats one each");
    assert_eq!(duel.iter().filter(|(side, _)| *side == 0).count(), 1);
    let skirmish = read(0);
    assert_eq!(skirmish.iter().filter(|(side, _)| *side == 0).count(), 2);

    // And it reports what the SCENARIO authored, not what the current picks
    // would produce. A roster that described the picks would describe itself,
    // and the list a player is choosing from would already contain the choice.
    ft_hull_choice(0, 0, 4);
    assert_eq!(read(1), duel, "a pick must not change what the roster reports");
    // The pick still works after the query, which is the other half: putting
    // the picks aside has to put them back.
    use sim_core::ffi::{ft_match_new, ft_read_ships, SHIP_STRIDE};
    ft_match_new(0xdead_beef, 0xcafe_0007, 1, 0b01);
    let n = ft_read_ships() as usize;
    let s = unsafe { core::slice::from_raw_parts(ft_scratch_ptr(), 16384) };
    let mine = (0..n)
        .map(|i| (s[64 + i * SHIP_STRIDE + 3] as u32, s[64 + i * SHIP_STRIDE + 1] as u32))
        .find(|(side, _)| *side == 0);
    assert_eq!(mine.map(|(_, cls)| cls), Some(4), "the pick survived the roster query");
    ft_hull_clear(0);
}
