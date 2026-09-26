/**
 * tilt-parallax.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Device-tilt parallax for Three.js, split into two small, framework-free parts:
 *
 *   TiltInput       – sensor permission, listening, and normalization.
 *                     Turns raw beta/gamma angles into a clamped target offset
 *                     in world units ({ x, y } in [-range, +range]).
 *
 *   ParallaxCamera  – glides a THREE.PerspectiveCamera toward that target with
 *                     frame-rate-independent lerp, always looking at an anchor.
 *
 * Neither class owns the render loop, so they drop into an existing game loop.
 * Requires a secure context (HTTPS or localhost): browsers don't deliver
 * orientation events to plain-HTTP pages.
 */

// ── helpers ──────────────────────────────────────────────────────────────────
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/**
 * Wrap an angle difference into [-180, 180].
 * beta runs -180..180, so near the ±180 seam a naive (a - b) can report a
 * ~360° jump for what is really a 1° move. Wrapping keeps deltas honest.
 */
const wrapDeg = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

/** Current screen rotation in degrees: 0, 90, 180 or 270. */
function screenAngle() {
  const a = (screen.orientation && typeof screen.orientation.angle === 'number')
    ? screen.orientation.angle
    : (typeof window.orientation === 'number' ? window.orientation : 0); // older iOS Safari
  return ((a % 360) + 360) % 360;
}

/**
 * The sensor reports tilt in the DEVICE's frame, but the player perceives
 * left/right and toward/away in the SCREEN's frame. When the phone is turned
 * to landscape the two frames differ by 90°, so the axes are swapped/negated.
 * Returns { x, y } where:
 *   x = tilt left(-)/right(+) as the player sees the screen
 *   y = tilt away(-)/toward(+) the player's face (the "holding angle")
 *
 * If a device reports an axis backwards, flip it with the invertX / invertY
 * options rather than editing this table.
 */
function toScreenFrame(beta, gamma, angle) {
  switch (angle) {
    case 90:  return { x: -beta,  y:  gamma };
    case 180: return { x: -gamma, y: -beta  };
    case 270: return { x:  beta,  y: -gamma };
    default:  return { x:  gamma, y:  beta  };   // 0 = normal portrait
  }
}

// ── TiltInput ────────────────────────────────────────────────────────────────
export class TiltInput {
  /**
   * @param {object}  opts
   * @param {number}  opts.maxTilt       Degrees of tilt that reach the full range (default 30).
   * @param {number}  opts.range         World units at full tilt (default 1.5 → output in [-1.5, 1.5]).
   * @param {number}  opts.baselineBeta  Natural holding angle in degrees (default 45).
   * @param {number}  opts.deadZone      Degrees ignored around the baseline, to hide sensor jitter (default 0.6).
   * @param {boolean} opts.invertX / opts.invertY  Flip an axis if it feels backwards.
   * @param {number}  opts.sensorTimeoutMs  How long to wait for a first real reading (default 1200).
   */
  constructor({
    maxTilt = 30, range = 1.5, baselineBeta = 45, deadZone = 0.6,
    invertX = false, invertY = false, sensorTimeoutMs = 1200,
  } = {}) {
    Object.assign(this, { maxTilt, range, deadZone, invertX, invertY, sensorTimeoutMs });

    // Baseline in the screen frame: no sideways tilt, held at `baselineBeta`.
    this.baseline = { x: 0, y: baselineBeta };

    // The one thing the rest of the game reads: target offset in world units.
    // Written by the event handler; read once per frame by the render loop.
    this.target = { x: 0, y: 0 };

    this._latest = null;          // last screen-frame reading, used by calibrate()
    this._active = false;
    this._onOrientation = this._onOrientation.bind(this);
  }

  /** True if this browser has the API at all (not proof there's a gyroscope). */
  static get isSupported() {
    return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
  }

  /** True on iOS 13+ Safari, where an explicit permission prompt is required. */
  static get needsPermission() {
    return TiltInput.isSupported &&
      typeof DeviceOrientationEvent.requestPermission === 'function';
  }

  /**
   * Ask for sensor access. MUST be called synchronously from a user gesture
   * (e.g. directly inside a click handler, before any other `await`), or
   * iOS rejects it. Resolves to one of:
   *   'granted' | 'not-required' | 'denied' | 'unsupported' | 'insecure'
   * It never throws: every failure path comes back as a reason string.
   */
  requestPermission() {
    if (!window.isSecureContext) return Promise.resolve('insecure');
    if (!TiltInput.isSupported) return Promise.resolve('unsupported');
    if (!TiltInput.needsPermission) return Promise.resolve('not-required');

    // requestPermission() itself must be invoked inside the gesture, so it is
    // called right here, synchronously; only its result is awaited later.
    return DeviceOrientationEvent.requestPermission()
      .then((state) => (state === 'granted' ? 'granted' : 'denied'))
      .catch(() => 'denied');   // thrown when not called from a gesture, or dismissed
  }

  /**
   * Start listening and confirm a real sensor is behind the API.
   * Desktop browsers expose DeviceOrientationEvent but never send readings
   * (or send one with null angles), so wait briefly for a genuine sample.
   * Resolves { ok: true } or { ok: false, reason: 'no-sensor' }.
   */
  start() {
    if (this._active) return Promise.resolve({ ok: true });
    this._active = true;
    window.addEventListener('deviceorientation', this._onOrientation, { passive: true });

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!this._latest) { this.stop(); resolve({ ok: false, reason: 'no-sensor' }); }
      }, this.sensorTimeoutMs);
      this._firstSample = () => { clearTimeout(timer); resolve({ ok: true }); };
    });
  }

  stop() {
    this._active = false;
    window.removeEventListener('deviceorientation', this._onOrientation);
    this.target.x = this.target.y = 0;   // settle back to centre, not to a stale offset
  }

  /**
   * Make however the player is holding the phone RIGHT NOW the neutral pose.
   * Better than the fixed 45° default for players who lie down, or hold the
   * phone flat on a table. Call it on game start and/or from a "re-centre" button.
   */
  calibrate() {
    if (this._latest) this.baseline = { x: this._latest.x, y: this._latest.y };
  }

  /**
   * Event handler: kept deliberately cheap (a few multiplies, no allocation
   * beyond one small object). It only computes the TARGET; all smoothing
   * happens once per frame in the render loop. Orientation events can arrive
   * faster than the display refreshes, so heavy work here would be wasted.
   */
  _onOrientation(e) {
    if (e.beta == null || e.gamma == null) return;        // no real sensor data

    const s = toScreenFrame(e.beta, e.gamma, screenAngle());
    const first = !this._latest;
    this._latest = s;
    if (first && this._firstSample) this._firstSample();

    this.target.x = this._map(s.x - this.baseline.x) * (this.invertX ? -1 : 1);
    this.target.y = this._map(s.y - this.baseline.y) * (this.invertY ? -1 : 1);
  }

  /**
   * Degrees away from baseline → world units:
   *
   *   1. wrap        d ∈ [-180, 180]         (no false jumps at the ±180 seam)
   *   2. dead zone   |d| ≤ deadZone → 0; otherwise shrink |d| by deadZone
   *                  so output starts from 0 at the edge instead of jumping
   *   3. clamp       d ∈ [-maxTilt, +maxTilt] (tilting past 30° does nothing
   *                  more, so the camera can never swing into geometry)
   *   4. normalize   n = d / maxTilt        ∈ [-1, 1]
   *   5. scale       out = n × range        ∈ [-1.5, 1.5] world units
   *
   * Example with defaults: a 15° tilt → (15 - 0.6) / 30 × 1.5 ≈ 0.72 units.
   */
  _map(deltaDeg) {
    let d = wrapDeg(deltaDeg);
    const mag = Math.abs(d);
    if (mag <= this.deadZone) return 0;
    d = Math.sign(d) * (mag - this.deadZone);
    d = clamp(d, -this.maxTilt, this.maxTilt);
    return (d / this.maxTilt) * this.range;
  }
}

// ── ParallaxCamera ───────────────────────────────────────────────────────────
export class ParallaxCamera {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {object}         opts
   * @param {THREE.Vector3}  opts.anchor     Focal point the camera always looks at.
   * @param {number}         opts.smoothing  Share of the remaining distance covered per
   *                                         frame AT 60 FPS, 0..1 (default 0.08).
   *                                         Lower = floatier; higher = snappier.
   * @param {boolean}        opts.invert     true (default): tilt right → camera moves
   *                                         left, like looking through a window.
   */
  constructor(camera, { anchor, smoothing = 0.08, invert = true } = {}) {
    this.camera = camera;
    this.anchor = anchor;
    this.smoothing = smoothing;
    this.sign = invert ? -1 : 1;
    this.rest = camera.position.clone();   // the camera's neutral position
    this.offset = { x: 0, y: 0 };          // current smoothed offset (world units)
  }

  /**
   * Advance one frame.
   * @param {number} dt      Seconds since the last frame.
   * @param {{x:number,y:number}} target  TiltInput.target.
   * @returns {boolean}      true if the camera moved enough to need a redraw.
   *
   * Lerp:  current += (target − current) × t
   *
   * A fixed t per frame would make the camera twice as fast at 120 Hz as at
   * 60 Hz, and sluggish when frames drop. So `smoothing` is defined at 60 FPS
   * and converted to this frame's real duration:
   *
   *     t = 1 − (1 − smoothing)^(dt × 60)
   *
   * Why: at 60 FPS the remaining gap shrinks by (1 − smoothing) each frame.
   * Over dt seconds, dt × 60 of those frames would have elapsed, so the gap
   * shrinks by (1 − smoothing)^(dt×60). Same visual speed at any frame rate.
   */
  update(dt, target) {
    const t = 1 - Math.pow(1 - this.smoothing, dt * 60);

    const tx = target.x * this.sign;
    const ty = target.y * this.sign;
    const dx = (tx - this.offset.x) * t;
    const dy = (ty - this.offset.y) * t;
    this.offset.x += dx;
    this.offset.y += dy;

    // Move only in the camera's X/Y plane; depth stays fixed, so the
    // perspective (and therefore the parallax strength) stays consistent.
    this.camera.position.set(
      this.rest.x + this.offset.x,
      this.rest.y + this.offset.y,
      this.rest.z,
    );

    // Re-aim at the anchor every frame. Near layers then sweep across the
    // view while the anchor plane stays put — that difference IS the parallax.
    this.camera.lookAt(this.anchor);

    // Movement below ~1/10,000 of a unit is invisible; report "no redraw
    // needed" so the loop can skip rendering and save battery at rest.
    return Math.abs(dx) + Math.abs(dy) > 1e-4;
  }
}
