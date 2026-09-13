import { Lighting } from "./contracts.wgsl";
@group(0) @binding(0) var blurred_rim: texture_2d<f32>;
@group(0) @binding(1) var linear_sampler: sampler;
@group(0) @binding(2) var<uniform> lighting: Lighting;

const SAMPLE_COUNT = 128;

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let light_uv = 0.5 + lighting.light * min(lighting.size.x, lighting.size.y) / lighting.size;
  let sample_scale = 48.0 / f32(SAMPLE_COUNT);
  let delta = (uv - light_uv) * (0.9 / f32(SAMPLE_COUNT));
  let decay = pow(0.965, sample_scale);
  var coordinate = uv;
  var rays = vec3f(0.0);
  var weight = 1.0;
  for (var i = 0; i < SAMPLE_COUNT; i++) {
    coordinate -= delta;
    rays += textureSample(blurred_rim, linear_sampler, coordinate).rgb * weight;
    weight *= decay;
  }
  return vec4f(rays * (0.075 * sample_scale), 1.0);
}
