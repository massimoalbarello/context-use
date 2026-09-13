// Scene distance functions and the sphere tracer every cascade ray runs.

/** A half-texel counts as a hit. */
export const SDF_HIT_EPSILON: f32 = 0.5;
/** Keep grazing rays moving. */
export const SDF_MIN_STEP: f32 = 0.35;
/** Distance fields converge quickly at 4x intervals. */
export const SDF_MAX_STEPS: i32 = 16;

export fn sdf_pixel_uv(pixel: vec2f, size: vec2f) -> vec2f {
  let half_texel = 0.5 / size;
  return clamp(pixel / size, half_texel, vec2f(1.0) - half_texel);
}

export fn sdf_sample(
  tex: texture_2d<f32>,
  samp: sampler,
  pixel: vec2f,
  size: vec2f,
) -> f32 {
  return textureSampleLevel(tex, samp, sdf_pixel_uv(pixel, size), 0.0).r;
}

/**
 * Marches `[t_start, t_end]` of one ray through the distance field.
 *
 * Returns `vec4f(radiance, visibility)`: on a hit, the emitter's linear radiance with
 * visibility 0 — the merge below will not add anything behind it; on an escape, black with
 * visibility 1, so the next cascade's longer interval continues the same ray.
 */
export fn sphere_trace(
  sdf_tex: texture_2d<f32>,
  sdf_samp: sampler,
  emitter_tex: texture_2d<f32>,
  emitter_samp: sampler,
  size: vec2f,
  origin: vec2f,
  direction: vec2f,
  t_start: f32,
  t_end: f32,
) -> vec4f {
  var t = t_start;
  for (var step = 0; step < SDF_MAX_STEPS; step = step + 1) {
    let p = origin + direction * t;
    // Off-screen is empty space: nothing to hit, and the field outside is extrapolated.
    if (
      p.x < -1.0 ||
      p.y < -1.0 ||
      p.x > size.x + 1.0 ||
      p.y > size.y + 1.0
    ) {
      break;
    }
    let d = sdf_sample(sdf_tex, sdf_samp, p, size);
    if (d <= SDF_HIT_EPSILON) {
      let emitter = textureSampleLevel(
        emitter_tex,
        emitter_samp,
        sdf_pixel_uv(p, size),
        0.0,
      );
      return vec4f(emitter.rgb, 0.0);
    }
    t = t + max(d, SDF_MIN_STEP);
    if (t > t_end) {
      break;
    }
  }
  return vec4f(0.0, 0.0, 0.0, 1.0);
}
