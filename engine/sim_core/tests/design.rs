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
         Geometry { plate_cells: 27059, ext: [28, 26, 93], radius_cells: 47.563115961845895, fouled: 0 },
         Expect { mass: 0.9007049798965454, hull: 249.08099365234375, radius: 2.6011078357696533, accel_fwd: 0.9992172718048096, accel_retro: 0.3330724239349365, accel_lat: 0.22204828262329102, max_speed: 5.0, yaw: 3.96344256401062, pitch: 2.6555066108703613, reach_u: 37.49020767211914, marines: 15, capacity: 6, boarding_range: 10.0, legal: true }),
        (ShipClassId::TerranCorvette,
         &[2, 1, 12, 13, 12, 13, 7, 7, 9, 9, 16, 17, 18, 19, 19],
         Geometry { plate_cells: 2268, ext: [20, 11, 43], radius_cells: 22.594247055390007, fouled: 0 },
         Expect { mass: 0.302172988653183, hull: 68.5989990234375, radius: 1.2356228828430176, accel_fwd: 1.4892131090164185, accel_retro: 0.9928087592124939, accel_lat: 0.3309362530708313, max_speed: 8.5, yaw: 12.775678634643555, pitch: 8.55970573425293, reach_u: 60.742225646972656, marines: 5, capacity: 2, boarding_range: 20.0, legal: true }),
        (ShipClassId::TerranDestroyer,
         &[5, 5, 5, 0, 0, 0, 12, 13, 12, 13, 12, 13, 12, 13, 12, 14, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 11, 11, 16, 17, 17, 17, 17, 17, 18, 18, 18, 18, 18, 19, 19],
         Geometry { plate_cells: 20251, ext: [44, 25, 84], radius_cells: 43.55743334954437, fouled: 0 },
         Expect { mass: 0.9901270270347595, hull: 252.94700622558594, radius: 2.382047176361084, accel_fwd: 1.9694442749023438, accel_retro: 0.6059828400611877, accel_lat: 0.4039885699748993, max_speed: 7.0, yaw: 7.983583450317383, pitch: 5.349001407623291, reach_u: 57.55994415283203, marines: 25, capacity: 10, boarding_range: 20.0, legal: true }),
        (ShipClassId::TerranCruiser,
         &[5, 5, 5, 5, 0, 0, 0, 0, 12, 13, 12, 13, 12, 13, 12, 13, 12, 13, 12, 13, 12, 14, 12, 14, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 11, 11, 16, 17, 17, 17, 17, 17, 17, 17, 17, 18, 18, 18, 18, 18, 18, 19, 19, 19, 19],
         Geometry { plate_cells: 57440, ext: [54, 31, 111], radius_cells: 57.66714836022326, fouled: 0 },
         Expect { mass: 1.7065000534057617, hull: 485.4800109863281, radius: 3.153672218322754, accel_fwd: 1.5235862731933594, accel_retro: 0.3515968322753906, accel_lat: 0.23439788818359375, max_speed: 7.0, yaw: 3.5054097175598145, pitch: 2.3486247062683105, reach_u: 53.919517517089844, marines: 40, capacity: 12, boarding_range: 30.0, legal: true }),
        (ShipClassId::KarisenCorvette,
         &[3, 3, 3, 12, 13, 15, 6, 6, 9, 9, 16, 17, 18, 19, 19],
         Geometry { plate_cells: 1870, ext: [12, 16, 48], radius_cells: 25.612496949731394, fouled: 0 },
         Expect { mass: 0.312732994556427, hull: 69.947998046875, radius: 1.4006834030151367, accel_fwd: 3.165639638900757, accel_retro: 0.31976157426834106, accel_lat: 0.31976157426834106, max_speed: 9.5, yaw: 11.058422088623047, pitch: 7.409142971038818, reach_u: 80.74537658691406, marines: 5, capacity: 2, boarding_range: 20.0, legal: true }),
        (ShipClassId::KarisenDestroyer,
         &[2, 2, 2, 0, 12, 13, 12, 13, 15, 15, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 11, 11, 16, 17, 17, 17, 17, 18, 18, 18, 19, 19],
         Geometry { plate_cells: 17457, ext: [24, 25, 92], radius_cells: 46.87483333303704, fouled: 0 },
         Expect { mass: 0.7086660265922546, hull: 187.552001953125, radius: 2.563467502593994, accel_fwd: 1.3405468463897705, accel_retro: 0.8466612100601196, accel_lat: 0.5644407868385315, max_speed: 8.5, yaw: 10.18447494506836, pitch: 6.823598861694336, reach_u: 58.05204391479492, marines: 20, capacity: 6, boarding_range: 20.0, legal: true }),
        (ShipClassId::KarisenCruiser,
         &[5, 5, 2, 2, 0, 12, 13, 12, 13, 15, 15, 15, 15, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 11, 11, 16, 17, 17, 17, 17, 17, 18, 18, 18, 19, 19],
         Geometry { plate_cells: 39347, ext: [32, 33, 123], radius_cells: 63.383751861182844, fouled: 0 },
         Expect { mass: 1.1217830181121826, hull: 322.625, radius: 3.466298818588257, accel_fwd: 1.6491602659225464, accel_retro: 0.5348628163337708, accel_lat: 0.3565751910209656, max_speed: 8.5, yaw: 4.812315940856934, pitch: 3.2242517471313477, reach_u: 63.094913482666016, marines: 25, capacity: 6, boarding_range: 20.0, legal: true }),
        (ShipClassId::RogueCorvette,
         &[3, 3, 0, 12, 14, 6, 6, 9, 9, 16, 17, 17, 17, 18, 18, 19, 19],
         Geometry { plate_cells: 945, ext: [24, 11, 36], radius_cells: 18.848076824970764, fouled: 0 },
         Expect { mass: 0.30561399459838867, hull: 66.41600036621094, radius: 1.0307542085647583, accel_fwd: 2.3231918811798096, accel_retro: 0.32721012830734253, accel_lat: 0.32721012830734253, max_speed: 9.5, yaw: 15.08802318572998, pitch: 10.108976364135742, reach_u: 75.5762939453125, marines: 15, capacity: 4, boarding_range: 20.0, legal: true }),
        (ShipClassId::RogueDestroyer,
         &[3, 3, 3, 12, 14, 12, 14, 12, 14, 7, 7, 7, 7, 10, 10, 8, 8, 11, 11, 8, 8, 16, 17, 17, 17, 17, 17, 17, 17, 17, 17, 18, 18, 18, 18, 18, 18, 18, 19, 19, 19, 19, 19, 19],
         Geometry { plate_cells: 8674, ext: [48, 19, 70], radius_cells: 36.07284297085551, fouled: 0 },
         Expect { mass: 0.8550220131874084, hull: 199.06500244140625, radius: 1.972733497619629, accel_fwd: 1.1578649282455444, accel_retro: 0.701736330986023, accel_lat: 0.32747694849967957, max_speed: 9.5, yaw: 7.76588249206543, pitch: 5.203141212463379, reach_u: 56.02740478515625, marines: 45, capacity: 14, boarding_range: 40.0, legal: true }),
        (ShipClassId::RogueCruiser,
         &[3, 3, 3, 3, 12, 14, 12, 14, 12, 14, 12, 14, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 11, 11, 16, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 18, 18, 18, 18, 18, 18, 18, 18, 19, 19, 19, 19, 19, 19, 19, 19],
         Geometry { plate_cells: 20972, ext: [64, 24, 91], radius_cells: 47.64714052280577, fouled: 0 },
         Expect { mass: 1.2631570100784302, hull: 312.010986328125, radius: 2.6057028770446777, accel_fwd: 1.0450007915496826, accel_retro: 0.4750003218650818, accel_lat: 0.3166669011116028, max_speed: 9.5, yaw: 5.7765607833862305, pitch: 3.870296001434326, reach_u: 51.818214416503906, marines: 70, capacity: 16, boarding_range: 50.0, legal: true }),
        (ShipClassId::BenefactorCorvette,
         &[1, 0, 0, 12, 14, 15, 7, 7, 9, 8, 16, 17, 18, 19, 19],
         Geometry { plate_cells: 1836, ext: [18, 19, 40], radius_cells: 20.524375751773793, fouled: 0 },
         Expect { mass: 0.2597709894180298, hull: 58.722999572753906, radius: 1.1224267482757568, accel_fwd: 0.9623861312866211, accel_retro: 1.1548633575439453, accel_lat: 0.2694680988788605, max_speed: 8.0, yaw: 11.182927131652832, pitch: 7.492561340332031, reach_u: 46.74931335449219, marines: 5, capacity: 2, boarding_range: 20.0, legal: true }),
        (ShipClassId::BenefactorDestroyer,
         &[5, 5, 0, 0, 12, 14, 12, 14, 12, 14, 15, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 11, 11, 16, 17, 17, 17, 17, 17, 18, 18, 18, 18, 18, 19, 19],
         Geometry { plate_cells: 19302, ext: [30, 36, 81], radius_cells: 42.27587964785594, fouled: 0 },
         Expect { mass: 0.8531950116157532, hull: 222.03399658203125, radius: 2.311962127685547, accel_fwd: 1.5236845016479492, accel_retro: 0.7032390236854553, accel_lat: 0.4688259959220886, max_speed: 7.0, yaw: 9.608038902282715, pitch: 6.437386512756348, reach_u: 53.920555114746094, marines: 25, capacity: 10, boarding_range: 20.0, legal: true }),
        (ShipClassId::BenefactorCruiser,
         &[5, 5, 5, 0, 0, 12, 14, 12, 14, 12, 14, 12, 14, 15, 15, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 11, 11, 16, 17, 17, 17, 17, 17, 17, 17, 18, 18, 18, 18, 18, 18, 19, 19, 19, 19],
         Geometry { plate_cells: 46467, ext: [40, 50, 107], radius_cells: 57.56083738098326, fouled: 0 },
         Expect { mass: 1.3751230239868164, hull: 391.6050109863281, radius: 3.147858142852783, accel_fwd: 1.3816945552825928, accel_retro: 0.4363245964050293, accel_lat: 0.29088306427001953, max_speed: 7.0, yaw: 4.512764930725098, pitch: 3.023552894592285, reach_u: 52.268150329589844, marines: 35, capacity: 12, boarding_range: 30.0, legal: true }),
        (ShipClassId::CivilLighter,
         &[4, 4, 7, 7, 9, 9, 9, 9, 16, 17, 18, 18, 23, 23],
         Geometry { plate_cells: 10514, ext: [28, 36, 60], radius_cells: 32.17141588429082, fouled: 0 },
         Expect { mass: 0.4376719892024994, hull: 115.24500274658203, radius: 1.7593743801116943, accel_fwd: 1.370889663696289, accel_retro: 0.6854448318481445, accel_lat: 0.4569632112979889, max_speed: 5.0, yaw: 12.64264965057373, pitch: 8.470575332641602, reach_u: 40.8818359375, marines: 5, capacity: 4, boarding_range: 10.0, legal: true }),
        (ShipClassId::CivilHauler,
         &[4, 4, 4, 7, 7, 7, 7, 9, 9, 9, 9, 9, 9, 16, 17, 17, 22, 18, 18, 18, 19, 19, 23, 23, 23, 23, 23, 23],
         Geometry { plate_cells: 19956, ext: [28, 36, 80], radius_cells: 41.6293165929973, fouled: 0 },
         Expect { mass: 1.0400710105895996, hull: 262.81298828125, radius: 2.2766032218933105, accel_fwd: 0.8653255105018616, accel_retro: 0.5768836736679077, accel_lat: 0.28844183683395386, max_speed: 5.0, yaw: 5.98516845703125, pitch: 4.010063171386719, reach_u: 35.554569244384766, marines: 10, capacity: 6, boarding_range: 20.0, legal: true }),
        (ShipClassId::CivilBoxship,
         &[5, 5, 5, 4, 4, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 11, 11, 16, 17, 17, 22, 18, 18, 18, 19, 19, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23],
         Geometry { plate_cells: 47283, ext: [36, 49, 113], radius_cells: 58.78350108661443, fouled: 0 },
         Expect { mass: 2.0288889408111572, hull: 531.0330200195312, radius: 3.2147226333618164, accel_fwd: 1.1829134225845337, accel_retro: 0.2957283556461334, accel_lat: 0.19715222716331482, max_speed: 7.0, yaw: 2.896218776702881, pitch: 1.9404667615890503, reach_u: 49.288421630859375, marines: 10, capacity: 6, boarding_range: 20.0, legal: true }),
        (ShipClassId::CivilTanker,
         &[5, 5, 5, 4, 4, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 16, 17, 17, 18, 18, 24, 24, 24, 24, 24, 24],
         Geometry { plate_cells: 52119, ext: [36, 38, 107], radius_cells: 54.94770240874499, fouled: 0 },
         Expect { mass: 1.8064299821853638, hull: 494.82598876953125, radius: 3.0049526691436768, accel_fwd: 1.328587293624878, accel_retro: 0.3321468234062195, accel_lat: 0.11071561276912689, max_speed: 7.0, yaw: 3.435288190841675, pitch: 1.150821566581726, reach_u: 51.559356689453125, marines: 10, capacity: 4, boarding_range: 10.0, legal: true }),
        (ShipClassId::CivilMiner,
         &[4, 4, 7, 7, 7, 7, 9, 9, 9, 9, 9, 9, 12, 27, 12, 27, 16, 17, 17, 18, 18, 19, 19, 25, 25, 25, 25],
         Geometry { plate_cells: 14465, ext: [40, 31, 71], radius_cells: 36.5991803186902, fouled: 0 },
         Expect { mass: 1.104714035987854, hull: 264.3559875488281, radius: 2.0015177726745605, accel_fwd: 0.5431270003318787, accel_retro: 0.5431270003318787, accel_lat: 0.27156350016593933, max_speed: 5.0, yaw: 6.349230766296387, pitch: 4.2539849281311035, reach_u: 26.985124588012695, marines: 10, capacity: 4, boarding_range: 20.0, legal: true }),
        (ShipClassId::CivilLiner,
         &[5, 5, 5, 1, 1, 7, 7, 7, 7, 10, 10, 10, 10, 11, 11, 11, 11, 16, 26, 26, 26, 26, 26, 26, 26, 26, 22, 22, 18, 18, 19, 19, 23, 23],
         Geometry { plate_cells: 48045, ext: [36, 44, 117], radius_cells: 60.201744160779924, fouled: 0 },
         Expect { mass: 1.636368989944458, hull: 450.0710144042969, radius: 3.292282819747925, accel_fwd: 1.2833291292190552, accel_retro: 0.36666545271873474, accel_lat: 0.2444436401128769, max_speed: 8.0, yaw: 3.468174934387207, pitch: 2.3236773014068604, reach_u: 55.06485366821289, marines: 16, capacity: 4, boarding_range: 20.0, legal: true }),
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
