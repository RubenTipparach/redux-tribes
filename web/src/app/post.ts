/**
 * Bloom, and the ladder that takes it away again.
 *
 * ADR-13 picked this fight already. Its quality ladder names "bloom-only
 * post", which is the whole permitted post-processing budget for a renderer
 * whose floor is a Raspberry Pi 5, and `SHADER_CATALOG.md` 5 records what the
 * archive actually set: threshold 2.0, intensity 0.5, scatter 0.7 over HDR
 * emissives. So this is not a new effect, it is the one effect the project
 * already decided it could afford, ported.
 *
 * **The ladder is the point, not the bloom.** A post chain that a phone cannot
 * run is worse than no post chain, because it fails as a slideshow rather than
 * as a plain picture. So the composer measures what it costs and stands itself
 * down: if the frame budget is not there, bloom goes and the renderer draws
 * straight to the canvas, which is exactly what it did before this module
 * existed.
 *
 * The measurement is deliberately slow to react and permanent once it fires.
 * A ladder that re-enabled itself the moment a frame got cheap would oscillate
 * between two looks while the camera moved, and a picture that changes when
 * you turn is worse than either of the two pictures.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * The archive's numbers, translated.
 *
 * Unity's threshold was 2.0 in HDR units against emissives authored at 3.0, so
 * only the genuinely hot things bloomed and the hull did not. Three's
 * `UnrealBloomPass` thresholds on luminance after tone mapping, so the same
 * INTENT is a value just under 1: engine glow, beams, blasts and the sun get
 * through, and lit plating does not.
 */
const STRENGTH = 0.62;
const RADIUS = 0.7;
const THRESHOLD = 0.78;

/**
 * The frame budget, in milliseconds.
 *
 * Turn based play is comfortable at 30 fps, which ADR-13 says in as many
 * words, so the ladder only fires when a frame is missing THAT rather than 60.
 * Bloom is not worth a stutter, but it is worth a frame that is merely not
 * spectacular.
 */
const BUDGET_MS = 1000 / 30;

/**
 * How many slow frames in a row before bloom goes.
 *
 * Long, because the first seconds of a match are the worst frames it will ever
 * have: hull geometry is being built, envelopes are being probed, and shaders
 * are compiling. Standing down on that evidence would take bloom away from
 * every machine that could easily have run it.
 */
const STRIKES = 90;

/** Frames to ignore entirely at startup, for the same reason. */
const WARMUP = 120;

export type Quality = 'bloom' | 'plain';

/**
 * Owns the post chain and decides whether to use it.
 *
 * Construct it with the renderer, scene and camera; call `render` where
 * `renderer.render` used to be called; call `resize` where `setSize` is.
 */
export class Post {
  readonly #renderer: THREE.WebGLRenderer;
  readonly #scene: THREE.Scene;
  readonly #camera: THREE.Camera;

  #composer: EffectComposer | null = null;
  #bloom: UnrealBloomPass | null = null;
  #quality: Quality = 'bloom';
  /** Set when a person chose, which switches the ladder off: an explicit
   *  choice is not something to second guess with a stopwatch. */
  #forced = false;

  #frames = 0;
  #slow = 0;
  /** Rolling frame cost, for reporting rather than for deciding. */
  #ms = 0;
  #lastAt = 0;
  #stoodDown = '';

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.#renderer = renderer;
    this.#scene = scene;
    this.#camera = camera;
    this.#build();
  }

  #build(): void {
    // A composer allocates two full screen render targets and the bloom pass
    // allocates five more at halving resolutions, so this happens once.
    const composer = new EffectComposer(this.#renderer);
    composer.addPass(new RenderPass(this.#scene, this.#camera));

    const size = new THREE.Vector2();
    this.#renderer.getSize(size);
    const bloom = new UnrealBloomPass(size, STRENGTH, RADIUS, THRESHOLD);
    composer.addPass(bloom);

    // Tone mapping and the colour space conversion move INTO the chain here.
    // Without this pass the composer writes linear values straight to an sRGB
    // canvas and everything comes out washed out and pale.
    composer.addPass(new OutputPass());

    this.#composer = composer;
    this.#bloom = bloom;
  }

  get quality(): Quality { return this.#quality; }
  /** Empty while bloom is running; otherwise why it is not. */
  get stoodDown(): string { return this.#stoodDown; }
  /** Rolling mean frame cost in milliseconds, for the harness to read. */
  get frameMs(): number { return this.#ms; }

  /**
   * Choose by hand, and stop the ladder measuring.
   *
   * The debug surface uses this to prove the two paths draw the same scene,
   * and a player who wants the plain look on a machine that could run bloom is
   * entitled to it.
   */
  force(q: Quality): void {
    this.#forced = true;
    this.#quality = q;
    this.#stoodDown = q === 'plain' ? 'turned off by hand' : '';
  }

  resize(w: number, h: number): void {
    this.#composer?.setSize(w, h);
    this.#bloom?.setSize(w, h);
  }

  /**
   * Draw a frame, and keep count of what it cost.
   *
   * The cost is measured across the whole call rather than around the draw,
   * because what matters is whether the machine can hold a frame rate, not
   * which line of it was slow.
   */
  render(): void {
    const start = performance.now();
    // The gap since the LAST frame is the real frame time: a draw call returns
    // as soon as the commands are queued, so timing the call alone measures
    // the CPU's share and misses everything the GPU is actually doing.
    const gap = this.#lastAt ? start - this.#lastAt : 0;
    this.#lastAt = start;

    if (this.#quality === 'bloom' && this.#composer) this.#composer.render();
    else this.#renderer.render(this.#scene, this.#camera);

    if (gap > 0 && gap < 1000) {
      this.#ms = this.#ms ? this.#ms * 0.92 + gap * 0.08 : gap;
      this.#judge(gap);
    }
  }

  /** One frame's worth of evidence about whether this machine can hold it. */
  #judge(gap: number): void {
    if (this.#forced || this.#quality !== 'bloom') return;
    this.#frames++;
    if (this.#frames < WARMUP) return;
    // A single slow frame is a garbage collection or a tab regaining focus.
    // Only an unbroken run of them is the machine telling you something.
    if (gap > BUDGET_MS) {
      this.#slow++;
      if (this.#slow >= STRIKES) {
        this.#quality = 'plain';
        this.#stoodDown =
          `${STRIKES} frames over ${BUDGET_MS.toFixed(1)} ms, last ${gap.toFixed(1)} ms`;
      }
    } else {
      this.#slow = 0;
    }
  }

  dispose(): void {
    this.#composer?.dispose();
    this.#composer = null;
    this.#bloom = null;
  }
}
