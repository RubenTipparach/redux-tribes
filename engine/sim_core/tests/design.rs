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
         Geometry { plate_cells: 5893, ext: [32, 14, 58], radius_cells: 30.099833886584822, fouled: 0 },
         Expect { mass: 0.9133740067481995, hull: 295.8819885253906, radius: 3.2921693325042725, accel_fwd: 0.9853575825691223, accel_retro: 0.32845252752304077, accel_lat: 0.21896834671497345, max_speed: 8.0, yaw: 6.267024993896484, pitch: 4.198907375335693, reach_u: 47.524478912353516, marines: 15, capacity: 8, boarding_range: 20.0, legal: true }),
        (ShipClassId::KarisenFrigate,
         &[2, 2, 2, 0, 12, 13, 15, 7, 7, 10, 10, 11, 11, 16, 17, 17, 17, 18, 18, 12, 13, 19, 19],
         Geometry { plate_cells: 4214, ext: [25, 16, 61], radius_cells: 32.101401838549044, fouled: 0 },
         Expect { mass: 0.7542920112609863, hull: 232.87600708007812, radius: 3.5110907554626465, accel_fwd: 1.2594592571258545, accel_retro: 0.3977239727973938, accel_lat: 0.2651492953300476, max_speed: 8.5, yaw: 7.215538024902344, pitch: 4.834411144256592, reach_u: 56.317054748535156, marines: 15, capacity: 4, boarding_range: 20.0, legal: true }),
        (ShipClassId::RogueFrigate,
         &[3, 3, 3, 12, 12, 14, 14, 7, 7, 6, 10, 10, 8, 8, 11, 11, 16, 17, 17, 17, 17, 17, 17, 17, 17, 18, 18, 18, 18, 18, 18, 19, 19, 19, 19, 19, 19],
         Geometry { plate_cells: 1851, ext: [32, 12, 47], radius_cells: 25.243811122728676, fouled: 0 },
         Expect { mass: 0.8063380122184753, hull: 202.29400634765625, radius: 2.7610418796539307, accel_fwd: 1.2277729511260986, accel_retro: 0.4340611398220062, accel_lat: 0.29764193296432495, max_speed: 9.5, yaw: 10.512459754943848, pitch: 7.0433478355407715, reach_u: 58.246463775634766, marines: 40, capacity: 12, boarding_range: 40.0, legal: true }),
        (ShipClassId::BenefactorFrigate,
         &[5, 0, 0, 1, 12, 12, 14, 14, 15, 7, 7, 10, 10, 11, 11, 16, 17, 17, 17, 18, 18, 18, 18, 19, 19],
         Geometry { plate_cells: 4272, ext: [28, 24, 57], radius_cells: 29.415132160165456, fouled: 0 },
         Expect { mass: 0.784276008605957, hull: 240.20799255371094, radius: 3.217280149459839, accel_fwd: 1.0838021039962769, accel_retro: 0.3825184106826782, accel_lat: 0.25501227378845215, max_speed: 8.0, yaw: 7.42667293548584, pitch: 4.975871562957764, reach_u: 50.47431182861328, marines: 15, capacity: 8, boarding_range: 20.0, legal: true }),
        (ShipClassId::Freighter,
         &[4, 4, 4, 7, 7, 9, 9, 9, 9, 16, 20, 20, 17, 17, 17, 18, 18, 18],
         Geometry { plate_cells: 5999, ext: [18, 18, 53], radius_cells: 27.33587386567329, fouled: 0 },
         Expect { mass: 2.2161169052124023, hull: 822.4650268554688, radius: 4.4847917556762695, accel_fwd: 0.40611574053764343, accel_retro: 0.13537190854549408, accel_lat: 0.09024794399738312, max_speed: 5.0, yaw: 2.826633930206299, pitch: 1.8938448429107666, reach_u: 20.3057861328125, marines: 15, capacity: 6, boarding_range: 10.0, legal: true }),
        (ShipClassId::TerranCorvette,
         &[2, 1, 12, 13, 12, 13, 7, 7, 9, 9, 16, 17, 18, 19, 19],
         Geometry { plate_cells: 2558, ext: [26, 15, 29], radius_cells: 16.718253497300488, fouled: 0 },
         Expect { mass: 0.4795840084552765, hull: 145.9320068359375, radius: 1.8285590410232544, accel_fwd: 0.9383131861686707, accel_retro: 0.625542163848877, accel_lat: 0.2085140496492386, max_speed: 8.5, yaw: 11.93563175201416, pitch: 7.99687385559082, reach_u: 46.50006103515625, marines: 5, capacity: 2, boarding_range: 20.0, legal: true }),
        (ShipClassId::TerranDestroyer,
         &[5, 5, 5, 0, 0, 0, 12, 13, 12, 13, 12, 13, 12, 13, 12, 14, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 11, 11, 16, 17, 17, 17, 17, 17, 18, 18, 18, 18, 18, 19, 19],
         Geometry { plate_cells: 5350, ext: [32, 19, 57], radius_cells: 31.024184114977142, fouled: 0 },
         Expect { mass: 2.2010679244995117, hull: 780.7930297851562, radius: 5.089905261993408, accel_fwd: 0.8859335780143738, accel_retro: 0.2725949287414551, accel_lat: 0.18172995746135712, max_speed: 7.0, yaw: 5.292486667633057, pitch: 3.545966386795044, reach_u: 42.345558166503906, marines: 25, capacity: 10, boarding_range: 20.0, legal: true }),
        (ShipClassId::TerranCruiser,
         &[5, 5, 5, 5, 0, 0, 0, 0, 12, 13, 12, 13, 12, 13, 12, 13, 12, 13, 12, 13, 12, 14, 12, 14, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 11, 11, 16, 17, 17, 17, 17, 17, 17, 17, 17, 18, 18, 18, 18, 18, 18, 19, 19, 19, 19],
         Geometry { plate_cells: 5676, ext: [32, 19, 57], radius_cells: 30.651264247988205, fouled: 0 },
         Expect { mass: 4.688283920288086, hull: 1785.2320556640625, radius: 6.7049641609191895, accel_fwd: 0.5545738935470581, accel_retro: 0.1279785931110382, accel_lat: 0.08531906455755234, max_speed: 7.0, yaw: 2.4847307205200195, pitch: 1.6647697687149048, reach_u: 27.728694915771484, marines: 40, capacity: 12, boarding_range: 30.0, legal: true }),
        (ShipClassId::KarisenCorvette,
         &[3, 3, 3, 12, 13, 15, 6, 6, 9, 9, 16, 17, 18, 19, 19],
         Geometry { plate_cells: 1809, ext: [16, 18, 38], radius_cells: 20.024984394500787, fouled: 0 },
         Expect { mass: 0.43560200929641724, hull: 123.50599670410156, radius: 2.190232753753662, accel_fwd: 2.272716760635376, accel_retro: 0.22956736385822296, accel_lat: 0.22956736385822296, max_speed: 9.5, yaw: 10.02846908569336, pitch: 6.719074726104736, reach_u: 75.14491271972656, marines: 5, capacity: 2, boarding_range: 20.0, legal: true }),
        (ShipClassId::KarisenDestroyer,
         &[2, 2, 2, 0, 12, 13, 12, 13, 15, 15, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 11, 11, 16, 17, 17, 17, 17, 18, 18, 18, 19, 19],
         Geometry { plate_cells: 4507, ext: [17, 19, 62], radius_cells: 32.24127789030702, fouled: 0 },
         Expect { mass: 1.7249280214309692, hull: 630.5380249023438, radius: 5.289585113525391, accel_fwd: 0.5507476329803467, accel_retro: 0.3478406071662903, accel_lat: 0.23189373314380646, max_speed: 8.5, yaw: 6.208767890930176, pitch: 4.15987491607666, reach_u: 27.537382125854492, marines: 20, capacity: 6, boarding_range: 20.0, legal: true }),
        (ShipClassId::KarisenCruiser,
         &[5, 5, 2, 2, 0, 12, 13, 12, 13, 15, 15, 15, 15, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 11, 11, 16, 17, 17, 17, 17, 17, 18, 18, 18, 19, 19],
         Geometry { plate_cells: 4358, ext: [20, 19, 63], radius_cells: 32.85574531189332, fouled: 0 },
         Expect { mass: 3.4575419425964355, hull: 1340.7760009765625, radius: 7.187193870544434, accel_fwd: 0.5350621938705444, accel_retro: 0.17353367805480957, accel_lat: 0.11568912118673325, max_speed: 8.5, yaw: 3.048316478729248, pitch: 2.042372226715088, reach_u: 26.753110885620117, marines: 25, capacity: 6, boarding_range: 20.0, legal: true }),
        (ShipClassId::RogueCorvette,
         &[3, 3, 0, 12, 14, 6, 6, 9, 9, 16, 17, 17, 17, 18, 18, 19, 19],
         Geometry { plate_cells: 950, ext: [32, 13, 25], radius_cells: 16.56804152578089, fouled: 0 },
         Expect { mass: 0.37049999833106995, hull: 94.69999694824219, radius: 1.8121294975280762, accel_fwd: 1.916329264640808, accel_retro: 0.26990553736686707, accel_lat: 0.26990553736686707, max_speed: 9.5, yaw: 17.921728134155273, pitch: 12.007558822631836, reach_u: 71.45237731933594, marines: 15, capacity: 4, boarding_range: 20.0, legal: true }),
        (ShipClassId::RogueDestroyer,
         &[3, 3, 3, 12, 14, 12, 14, 12, 14, 7, 7, 7, 7, 10, 10, 8, 8, 11, 11, 8, 8, 16, 17, 17, 17, 17, 17, 17, 17, 17, 17, 18, 18, 18, 18, 18, 18, 18, 19, 19, 19, 19, 19, 19],
         Geometry { plate_cells: 1809, ext: [32, 14, 47], radius_cells: 24.904818810824544, fouled: 0 },
         Expect { mass: 1.246669054031372, hull: 369.7829895019531, radius: 4.085947036743164, accel_fwd: 0.7941161394119263, accel_retro: 0.4812825322151184, accel_lat: 0.22459851205348969, max_speed: 9.5, yaw: 7.932628154754639, pitch: 5.314860820770264, reach_u: 39.705806732177734, marines: 45, capacity: 14, boarding_range: 40.0, legal: true }),
        (ShipClassId::RogueCruiser,
         &[3, 3, 3, 3, 12, 14, 12, 14, 12, 14, 12, 14, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 11, 11, 16, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 18, 18, 18, 18, 18, 18, 18, 18, 19, 19, 19, 19, 19, 19, 19, 19],
         Geometry { plate_cells: 2109, ext: [32, 12, 47], radius_cells: 26.462237244798484, fouled: 0 },
         Expect { mass: 2.3746960163116455, hull: 796.5280151367188, radius: 5.788614273071289, accel_fwd: 0.5558606386184692, accel_retro: 0.25266391038894653, accel_lat: 0.16844260692596436, max_speed: 9.5, yaw: 5.949249744415283, pitch: 3.9859976768493652, reach_u: 27.79302978515625, marines: 70, capacity: 16, boarding_range: 50.0, legal: true }),
        (ShipClassId::BenefactorCorvette,
         &[1, 0, 0, 12, 14, 15, 7, 7, 9, 8, 16, 17, 18, 19, 19],
         Geometry { plate_cells: 2137, ext: [20, 24, 28], radius_cells: 15.394804318340652, fouled: 0 },
         Expect { mass: 0.4085560142993927, hull: 123.5780029296875, radius: 1.6838066577911377, accel_fwd: 0.6119112372398376, accel_retro: 0.7342934608459473, accel_lat: 0.1713351458311081, max_speed: 8.0, yaw: 10.157726287841797, pitch: 6.805676460266113, reach_u: 30.595561981201172, marines: 5, capacity: 2, boarding_range: 20.0, legal: true }),
        (ShipClassId::BenefactorDestroyer,
         &[5, 5, 0, 0, 12, 14, 12, 14, 12, 14, 15, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 11, 11, 16, 17, 17, 17, 17, 17, 18, 18, 18, 18, 18, 19, 19],
         Geometry { plate_cells: 5139, ext: [28, 26, 55], radius_cells: 29.090376415577712, fouled: 0 },
         Expect { mass: 2.0178420543670654, hull: 729.7000122070312, radius: 4.772639751434326, accel_fwd: 0.644252598285675, accel_retro: 0.29734736680984497, accel_lat: 0.19823157787322998, max_speed: 7.0, yaw: 5.982989311218262, pitch: 4.008603096008301, reach_u: 32.21263122558594, marines: 25, capacity: 10, boarding_range: 20.0, legal: true }),
        (ShipClassId::BenefactorCruiser,
         &[5, 5, 5, 0, 0, 12, 14, 12, 14, 12, 14, 12, 14, 15, 15, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 11, 11, 16, 17, 17, 17, 17, 17, 17, 17, 18, 18, 18, 18, 18, 18, 19, 19, 19, 19],
         Geometry { plate_cells: 4974, ext: [28, 27, 55], radius_cells: 29.47032405658275, fouled: 0 },
         Expect { mass: 4.025846004486084, hull: 1547.0479736328125, radius: 6.446633338928223, accel_fwd: 0.471950501203537, accel_retro: 0.14903700351715088, accel_lat: 0.09935799986124039, max_speed: 7.0, yaw: 2.998805046081543, pitch: 2.009199619293213, reach_u: 23.597524642944336, marines: 35, capacity: 12, boarding_range: 30.0, legal: true }),
        (ShipClassId::CivilLighter,
         &[4, 4, 7, 7, 9, 9, 9, 9, 16, 17, 18, 18, 23, 23],
         Geometry { plate_cells: 3010, ext: [18, 18, 40], radius_cells: 20.71231517720798, fouled: 0 },
         Expect { mass: 0.5699399709701538, hull: 172.89999389648438, radius: 2.265409469604492, accel_fwd: 1.0527423620224, accel_retro: 0.5263711810112, accel_lat: 0.3509141206741333, max_speed: 5.0, yaw: 14.562936782836914, pitch: 9.75716781616211, reach_u: 38.126251220703125, marines: 5, capacity: 4, boarding_range: 10.0, legal: true }),
        (ShipClassId::CivilHauler,
         &[4, 4, 4, 7, 7, 7, 7, 9, 9, 9, 9, 9, 9, 16, 17, 17, 22, 18, 18, 18, 19, 19, 23, 23, 23, 23, 23, 23],
         Geometry { plate_cells: 5181, ext: [18, 18, 58], radius_cells: 29.427877939124322, fouled: 0 },
         Expect { mass: 2.209398031234741, hull: 772.52001953125, radius: 4.8280110359191895, accel_fwd: 0.4073507785797119, accel_retro: 0.2715671956539154, accel_lat: 0.1357835978269577, max_speed: 5.0, yaw: 3.8862202167510986, pitch: 2.6037678718566895, reach_u: 20.367538452148438, marines: 10, capacity: 6, boarding_range: 20.0, legal: true }),
        (ShipClassId::CivilBoxship,
         &[5, 5, 5, 4, 4, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 11, 11, 16, 17, 17, 22, 18, 18, 18, 19, 19, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23],
         Geometry { plate_cells: 5211, ext: [18, 18, 58], radius_cells: 29.9833287011299, fouled: 0 },
         Expect { mass: 4.819543838500977, hull: 1747.4720458984375, radius: 6.5588531494140625, accel_fwd: 0.49797242879867554, accel_retro: 0.12449310719966888, accel_lat: 0.08299540728330612, max_speed: 7.0, yaw: 2.3753857612609863, pitch: 1.5915086269378662, reach_u: 24.898622512817383, marines: 10, capacity: 6, boarding_range: 20.0, legal: true }),
        (ShipClassId::CivilTanker,
         &[5, 5, 5, 4, 4, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 16, 17, 17, 18, 18, 24, 24, 24, 24, 24, 24],
         Geometry { plate_cells: 5778, ext: [18, 18, 55], radius_cells: 28.53506614676055, fouled: 0 },
         Expect { mass: 4.903741836547852, hull: 1844.93603515625, radius: 6.242045879364014, accel_fwd: 0.48942217230796814, accel_retro: 0.12235554307699203, accel_lat: 0.040785178542137146, max_speed: 7.0, yaw: 2.461941719055176, pitch: 0.824750542640686, reach_u: 24.47110939025879, marines: 10, capacity: 4, boarding_range: 10.0, legal: true }),
        (ShipClassId::CivilMiner,
         &[4, 4, 7, 7, 7, 7, 9, 9, 9, 9, 9, 9, 12, 27, 12, 27, 16, 17, 17, 18, 18, 19, 19, 25, 25, 25, 25],
         Geometry { plate_cells: 4006, ext: [26, 18, 48], radius_cells: 24.819347291981714, fouled: 0 },
         Expect { mass: 2.0182600021362305, hull: 662.5689697265625, radius: 4.071924209594727, accel_fwd: 0.297285795211792, accel_retro: 0.297285795211792, accel_lat: 0.148642897605896, max_speed: 5.0, yaw: 5.140566825866699, pitch: 3.4441800117492676, reach_u: 14.864290237426758, marines: 10, capacity: 4, boarding_range: 20.0, legal: true }),
        (ShipClassId::CivilLiner,
         &[5, 5, 5, 1, 1, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 11, 11, 16, 26, 26, 26, 26, 26, 26, 26, 26, 22, 22, 18, 18, 19, 19, 23, 23],
         Geometry { plate_cells: 5311, ext: [18, 18, 60], radius_cells: 30.95157508108432, fouled: 0 },
         Expect { mass: 4.481994152069092, hull: 1690.4720458984375, radius: 6.770657062530518, accel_fwd: 0.4685414433479309, accel_retro: 0.1338689923286438, accel_lat: 0.0892459899187088, max_speed: 8.0, yaw: 2.4691390991210938, pitch: 1.6543233394622803, reach_u: 23.42707061767578, marines: 16, capacity: 4, boarding_range: 20.0, legal: true }),
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
    assert!((hull - 194.848).abs() < 0.1, "a designed hull carries its own hull: {hull}");
    assert_eq!(marines, 40, "and its own marines");
    assert!((radius - 2.6595).abs() < 0.01, "and its own radius: {radius}");
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
