import { Lighting } from "./contracts.wgsl";
@group(0) @binding(0) var blurred_rim: texture_2d<f32>;
@group(0) @binding(1) var linear_sampler: sampler;
@group(0) @binding(2) var<uniform> lighting: Lighting;
struct RayQuality { samples: u32 };
@group(0) @binding(3) var<uniform> quality: RayQuality;

const SOURCE_DISTANCE = 0.5;
const RAY_REACH = 0.9;

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let aim = lighting.light / max(length(lighting.light), 0.00001);
  // Place the source behind the mark so the rays fan outward in the cursor's direction.
  let source_uv = 0.5 - aim * SOURCE_DISTANCE * min(lighting.size.x, lighting.size.y) / lighting.size;
  let direction = source_uv - uv;
  // Keep samples inside the canvas to avoid gaps in long beams.
  let boundary = select(uv, 1.0 - uv, direction > vec2f(0.0));
  let travel = boundary / max(abs(direction), vec2f(0.00001));
  let exit = min(travel.x, travel.y);
  let end_progress = min(RAY_REACH, exit);
  let sample_scale = 48.0 * end_progress / (RAY_REACH * f32(quality.samples));
  let decay = pow(0.965, sample_scale);
  var rays = vec3f(0.0);
  var weight = 1.0;
  for (var i = 0u; i < quality.samples; i++) {
    let progress = (f32(i) + 0.5) * end_progress / f32(quality.samples);
    let coordinate = uv + direction * progress;
    rays += textureSample(blurred_rim, linear_sampler, coordinate).rgb * weight;
    weight *= decay;
  }
  return vec4f(rays * (0.12 * sample_scale), 1.0);
}
