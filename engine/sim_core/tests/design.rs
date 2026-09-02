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
         Geometry { plate_cells: 6001, ext: [32, 14, 58], radius_cells: 30.099833886584822, fouled: 0 },
         Expect { mass: 0.5122299790382385, hull: 121.02400207519531, radius: 1.6460846662521362, accel_fwd: 1.7570232152938843, accel_retro: 0.5856744050979614, accel_lat: 0.3904496133327484, max_speed: 8.0, yaw: 11.17493724822998, pitch: 7.487208366394043, reach_u: 61.787376403808594, marines: 15, capacity: 8, boarding_range: 20.0, legal: true }),
        (ShipClassId::KarisenFrigate,
         &[2, 2, 2, 0, 12, 13, 15, 7, 7, 10, 10, 11, 11, 16, 17, 17, 17, 18, 18, 12, 13, 19, 19],
         Geometry { plate_cells: 4163, ext: [20, 17, 61], radius_cells: 31.32890039564108, fouled: 0 },
         Expect { mass: 0.4661889970302582, hull: 107.29299926757812, radius: 1.71329927444458, accel_fwd: 2.0378000736236572, accel_retro: 0.6435158252716064, accel_lat: 0.4290105402469635, max_speed: 8.5, yaw: 11.674713134765625, pitch: 7.82205867767334, reach_u: 67.27255249023438, marines: 15, capacity: 4, boarding_range: 20.0, legal: true }),
        (ShipClassId::RogueFrigate,
         &[3, 3, 3, 12, 12, 14, 14, 7, 7, 6, 10, 10, 8, 8, 11, 11, 16, 17, 17, 17, 17, 17, 17, 17, 17, 18, 18, 18, 18, 18, 18, 19, 19, 19, 19, 19, 19],
         Geometry { plate_cells: 1909, ext: [32, 12, 47], radius_cells: 24.904818810824544, fouled: 0 },
         Expect { mass: 0.6805729866027832, hull: 147.47300720214844, radius: 1.3619823455810547, accel_fwd: 1.4546566009521484, accel_retro: 0.5142725110054016, accel_lat: 0.35264402627944946, max_speed: 9.5, yaw: 12.455087661743164, pitch: 8.344908714294434, reach_u: 63.97893524169922, marines: 40, capacity: 12, boarding_range: 40.0, legal: true }),
        (ShipClassId::BenefactorFrigate,
         &[5, 0, 0, 1, 12, 12, 14, 14, 15, 7, 7, 10, 10, 11, 11, 16, 17, 17, 17, 18, 18, 18, 18, 19, 19],
         Geometry { plate_cells: 4260, ext: [20, 24, 57], radius_cells: 29.415132160165456, fouled: 0 },
         Expect { mass: 0.49259498715400696, hull: 113.06500244140625, radius: 1.6086400747299194, accel_fwd: 1.725555419921875, accel_retro: 0.6090195775032043, accel_lat: 0.40601304173469543, max_speed: 8.0, yaw: 11.824239730834961, pitch: 7.9222412109375, reach_u: 61.45524597167969, marines: 15, capacity: 8, boarding_range: 20.0, legal: true }),
        (ShipClassId::Freighter,
         &[4, 4, 4, 7, 7, 9, 9, 9, 9, 16, 20, 20, 17, 17, 17, 18, 18, 18],
         Geometry { plate_cells: 6056, ext: [18, 18, 53], radius_cells: 27.33587386567329, fouled: 0 },
         Expect { mass: 2.2311220169067383, hull: 829.0059814453125, radius: 4.4847917556762695, accel_fwd: 0.4033844769001007, accel_retro: 0.13446149230003357, accel_lat: 0.08964099735021591, max_speed: 5.0, yaw: 2.8076236248016357, pitch: 1.881108045578003, reach_u: 20.16922378540039, marines: 15, capacity: 6, boarding_range: 10.0, legal: true }),
        (ShipClassId::TerranCorvette,
         &[2, 1, 12, 13, 12, 13, 7, 7, 9, 9, 16, 17, 18, 19, 19],
         Geometry { plate_cells: 2579, ext: [26, 15, 29], radius_cells: 16.718253497300488, fouled: 0 },
         Expect { mass: 0.30520498752593994, hull: 69.9209976196289, radius: 0.9142795205116272, accel_fwd: 1.4744188785552979, accel_retro: 0.9829458594322205, accel_lat: 0.3276486396789551, max_speed: 8.5, yaw: 18.75506019592285, pitch: 12.56589126586914, reach_u: 60.49882125854492, marines: 5, capacity: 2, boarding_range: 20.0, legal: true }),
        (ShipClassId::TerranDestroyer,
         &[5, 5, 5, 0, 0, 0, 12, 13, 12, 13, 12, 13, 12, 13, 12, 14, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 11, 11, 16, 17, 17, 17, 17, 17, 18, 18, 18, 18, 18, 19, 19],
         Geometry { plate_cells: 5410, ext: [32, 19, 57], radius_cells: 31.024184114977142, fouled: 0 },
         Expect { mass: 1.2146600484848022, hull: 350.82000732421875, radius: 3.3932700157165527, accel_fwd: 1.605387568473816, accel_retro: 0.49396538734436035, accel_lat: 0.32931026816368103, max_speed: 7.0, yaw: 9.590437889099121, pitch: 6.425594329833984, reach_u: 54.738887786865234, marines: 25, capacity: 10, boarding_range: 20.0, legal: true }),
        (ShipClassId::TerranCruiser,
         &[5, 5, 5, 5, 0, 0, 0, 0, 12, 13, 12, 13, 12, 13, 12, 13, 12, 13, 12, 13, 12, 14, 12, 14, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 11, 11, 16, 17, 17, 17, 17, 17, 17, 17, 17, 18, 18, 18, 18, 18, 18, 19, 19, 19, 19],
         Geometry { plate_cells: 5727, ext: [30, 19, 58], radius_cells: 31.11671576500322, fouled: 0 },
         Expect { mass: 4.7201080322265625, hull: 1799.10400390625, radius: 6.806781768798828, accel_fwd: 0.5508348345756531, accel_retro: 0.12711574137210846, accel_lat: 0.08474382013082504, max_speed: 7.0, yaw: 2.425426721572876, pitch: 1.6250360012054443, reach_u: 27.5417423248291, marines: 40, capacity: 12, boarding_range: 30.0, legal: true }),
        (ShipClassId::KarisenCorvette,
         &[3, 3, 3, 12, 13, 15, 6, 6, 9, 9, 16, 17, 18, 19, 19],
         Geometry { plate_cells: 1776, ext: [16, 18, 38], radius_cells: 20.024984394500787, fouled: 0 },
         Expect { mass: 0.31181600689888, hull: 69.5479965209961, radius: 1.095116376876831, accel_fwd: 3.1749494075775146, accel_retro: 0.3207019567489624, accel_lat: 0.3207019567489624, max_speed: 9.5, yaw: 14.009611129760742, pitch: 9.38644027709961, reach_u: 80.78717041015625, marines: 5, capacity: 2, boarding_range: 20.0, legal: true }),
        (ShipClassId::KarisenDestroyer,
         &[2, 2, 2, 0, 12, 13, 12, 13, 15, 15, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 11, 11, 16, 17, 17, 17, 17, 18, 18, 18, 19, 19],
         Geometry { plate_cells: 4507, ext: [17, 19, 62], radius_cells: 32.24127789030702, fouled: 0 },
         Expect { mass: 0.8900060057640076, hull: 266.5979919433594, radius: 3.5263900756835938, accel_fwd: 1.067408561706543, accel_retro: 0.6741527318954468, accel_lat: 0.44943517446517944, max_speed: 8.5, yaw: 12.03326416015625, pitch: 8.062287330627441, reach_u: 51.15635299682617, marines: 20, capacity: 6, boarding_range: 20.0, legal: true }),
        (ShipClassId::KarisenCruiser,
         &[5, 5, 2, 2, 0, 12, 13, 12, 13, 15, 15, 15, 15, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 11, 11, 16, 17, 17, 17, 17, 17, 18, 18, 18, 19, 19],
         Geometry { plate_cells: 4377, ext: [20, 19, 63], radius_cells: 32.85574531189332, fouled: 0 },
         Expect { mass: 3.469398021697998, hull: 1345.9439697265625, radius: 7.187193870544434, accel_fwd: 0.5332337021827698, accel_retro: 0.1729406714439392, accel_lat: 0.11529377847909927, max_speed: 8.5, yaw: 3.0378994941711426, pitch: 2.0353927612304688, reach_u: 26.661684036254883, marines: 25, capacity: 6, boarding_range: 20.0, legal: true }),
        (ShipClassId::RogueCorvette,
         &[3, 3, 0, 12, 14, 6, 6, 9, 9, 16, 17, 17, 17, 18, 18, 19, 19],
         Geometry { plate_cells: 943, ext: [32, 13, 25], radius_cells: 16.56804152578089, fouled: 0 },
         Expect { mass: 0.30559399724006653, hull: 66.40799713134766, radius: 0.9060647487640381, accel_fwd: 2.3233439922332764, accel_retro: 0.3272315561771393, accel_lat: 0.3272315561771393, max_speed: 9.5, yaw: 21.728174209594727, pitch: 14.557878494262695, reach_u: 75.57756042480469, marines: 15, capacity: 4, boarding_range: 20.0, legal: true }),
        (ShipClassId::RogueDestroyer,
         &[3, 3, 3, 12, 14, 12, 14, 12, 14, 7, 7, 7, 7, 10, 10, 8, 8, 11, 11, 8, 8, 16, 17, 17, 17, 17, 17, 17, 17, 17, 17, 18, 18, 18, 18, 18, 18, 18, 19, 19, 19, 19, 19, 19],
         Geometry { plate_cells: 1838, ext: [32, 14, 49], radius_cells: 25.30316185775999, fouled: 0 },
         Expect { mass: 0.9138140082359314, hull: 224.69200134277344, radius: 2.767533302307129, accel_fwd: 1.0833714008331299, accel_retro: 0.6565887331962585, accel_lat: 0.3064080774784088, max_speed: 9.5, yaw: 10.380355834960938, pitch: 6.954838752746582, reach_u: 53.34761428833008, marines: 45, capacity: 14, boarding_range: 40.0, legal: true }),
        (ShipClassId::RogueCruiser,
         &[3, 3, 3, 3, 12, 14, 12, 14, 12, 14, 12, 14, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 11, 11, 16, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 18, 18, 18, 18, 18, 18, 18, 18, 19, 19, 19, 19, 19, 19, 19, 19],
         Geometry { plate_cells: 2281, ext: [32, 12, 47], radius_cells: 26.462237244798484, fouled: 0 },
         Expect { mass: 2.4820239543914795, hull: 843.31201171875, radius: 5.788614273071289, accel_fwd: 0.5318240523338318, accel_retro: 0.2417382001876831, accel_lat: 0.16115880012512207, max_speed: 9.5, yaw: 5.691991329193115, pitch: 3.8136346340179443, reach_u: 26.591203689575195, marines: 70, capacity: 16, boarding_range: 50.0, legal: true }),
        (ShipClassId::BenefactorCorvette,
         &[1, 0, 0, 12, 14, 15, 7, 7, 9, 8, 16, 17, 18, 19, 19],
         Geometry { plate_cells: 2164, ext: [20, 24, 28], radius_cells: 15.394804318340652, fouled: 0 },
         Expect { mass: 0.2629689872264862, hull: 60.117000579833984, radius: 0.8419033288955688, accel_fwd: 0.9506824016571045, accel_retro: 1.1408188343048096, accel_lat: 0.2661910653114319, max_speed: 8.0, yaw: 15.781329154968262, pitch: 10.573491096496582, reach_u: 46.3399658203125, marines: 5, capacity: 2, boarding_range: 20.0, legal: true }),
        (ShipClassId::BenefactorDestroyer,
         &[5, 5, 0, 0, 12, 14, 12, 14, 12, 14, 15, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 11, 11, 16, 17, 17, 17, 17, 17, 18, 18, 18, 18, 18, 19, 19],
         Geometry { plate_cells: 5113, ext: [20, 26, 55], radius_cells: 29.415132160165456, fouled: 0 },
         Expect { mass: 1.0638140439987183, hull: 313.8420104980469, radius: 3.217280149459839, accel_fwd: 1.2220181226730347, accel_retro: 0.564008355140686, accel_lat: 0.3760055899620056, max_speed: 7.0, yaw: 11.348531723022461, pitch: 7.603516578674316, reach_u: 49.95119857788086, marines: 25, capacity: 10, boarding_range: 20.0, legal: true }),
        (ShipClassId::BenefactorCruiser,
         &[5, 5, 5, 0, 0, 12, 14, 12, 14, 12, 14, 12, 14, 15, 15, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 11, 11, 16, 17, 17, 17, 17, 17, 17, 17, 18, 18, 18, 18, 18, 18, 19, 19, 19, 19],
         Geometry { plate_cells: 4892, ext: [20, 27, 55], radius_cells: 29.47032405658275, fouled: 0 },
         Expect { mass: 3.9746780395507812, hull: 1524.7440185546875, radius: 6.446633338928223, accel_fwd: 0.4780261516571045, accel_retro: 0.15095561742782593, accel_lat: 0.10063708573579788, max_speed: 7.0, yaw: 3.037410020828247, pitch: 2.035064935684204, reach_u: 23.901308059692383, marines: 35, capacity: 12, boarding_range: 30.0, legal: true }),
        (ShipClassId::CivilLighter,
         &[4, 4, 7, 7, 9, 9, 9, 9, 16, 17, 18, 18, 23, 23],
         Geometry { plate_cells: 2939, ext: [18, 24, 40], radius_cells: 22.0, fouled: 0 },
         Expect { mass: 0.5644019842147827, hull: 170.48599243164062, radius: 2.40625, accel_fwd: 1.0630720853805542, accel_retro: 0.5315360426902771, accel_lat: 0.35435736179351807, max_speed: 5.0, yaw: 14.705829620361328, pitch: 9.852907180786133, reach_u: 38.24162292480469, marines: 5, capacity: 4, boarding_range: 10.0, legal: true }),
        (ShipClassId::CivilHauler,
         &[4, 4, 4, 7, 7, 7, 7, 9, 9, 9, 9, 9, 9, 16, 17, 17, 22, 18, 18, 18, 19, 19, 23, 23, 23, 23, 23, 23],
         Geometry { plate_cells: 5295, ext: [18, 24, 54], radius_cells: 28.89636655359978, fouled: 0 },
         Expect { mass: 1.2585099935531616, hull: 358.0299987792969, radius: 3.1605401039123535, accel_fwd: 0.715131402015686, accel_retro: 0.47675424814224243, accel_lat: 0.23837712407112122, max_speed: 5.0, yaw: 7.327889442443848, pitch: 4.90968656539917, reach_u: 32.520694732666016, marines: 10, capacity: 6, boarding_range: 20.0, legal: true }),
        (ShipClassId::CivilBoxship,
         &[5, 5, 5, 4, 4, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 11, 11, 16, 17, 17, 22, 18, 18, 18, 19, 19, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23],
         Geometry { plate_cells: 5345, ext: [20, 25, 58], radius_cells: 30.630866784993206, fouled: 0 },
         Expect { mass: 4.903160095214844, hull: 1783.9200439453125, radius: 6.700502395629883, accel_fwd: 0.48948025703430176, accel_retro: 0.12237006425857544, accel_lat: 0.08158004283905029, max_speed: 7.0, yaw: 2.3348770141601562, pitch: 1.564367651939392, reach_u: 24.47401237487793, marines: 10, capacity: 6, boarding_range: 20.0, legal: true }),
        (ShipClassId::CivilTanker,
         &[5, 5, 5, 4, 4, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 16, 17, 17, 18, 18, 24, 24, 24, 24, 24, 24],
         Geometry { plate_cells: 5684, ext: [18, 23, 55], radius_cells: 28.939592256975562, fouled: 0 },
         Expect { mass: 4.845086097717285, hull: 1819.3680419921875, radius: 6.330535888671875, accel_fwd: 0.4953472316265106, accel_retro: 0.12383680790662766, accel_lat: 0.041278935968875885, max_speed: 7.0, yaw: 2.491746664047241, pitch: 0.8347352147102356, reach_u: 24.76736068725586, marines: 10, capacity: 4, boarding_range: 10.0, legal: true }),
        (ShipClassId::CivilMiner,
         &[4, 4, 7, 7, 7, 7, 9, 9, 9, 9, 9, 9, 12, 27, 12, 27, 16, 17, 17, 18, 18, 19, 19, 25, 25, 25, 25],
         Geometry { plate_cells: 4200, ext: [32, 23, 48], radius_cells: 25.144581921360317, fouled: 0 },
         Expect { mass: 1.2912800312042236, hull: 345.67999267578125, radius: 2.7501888275146484, accel_fwd: 0.46465522050857544, accel_retro: 0.46465522050857544, accel_lat: 0.23232761025428772, max_speed: 5.0, yaw: 8.034663200378418, pitch: 5.383224964141846, reach_u: 23.23276138305664, marines: 10, capacity: 4, boarding_range: 20.0, legal: true }),
        (ShipClassId::CivilLiner,
         &[5, 5, 5, 1, 1, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 11, 11, 16, 26, 26, 26, 26, 26, 26, 26, 26, 22, 22, 18, 18, 19, 19, 23, 23],
         Geometry { plate_cells: 5406, ext: [18, 24, 60], radius_cells: 31.448370387032774, fouled: 0 },
         Expect { mass: 4.541274070739746, hull: 1716.31201171875, radius: 6.879331111907959, accel_fwd: 0.4624252915382385, accel_retro: 0.1321215182542801, accel_lat: 0.0880810096859932, max_speed: 8.0, yaw: 2.436908006668091, pitch: 1.6327284574508667, reach_u: 23.12126350402832, marines: 16, capacity: 4, boarding_range: 20.0, legal: true }),
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
