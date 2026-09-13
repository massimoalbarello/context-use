import { Lighting } from "./contracts.wgsl";
@group(0) @binding(0) var field: texture_2d<f32>;
@group(0) @binding(1) var linear_sampler: sampler;
@group(0) @binding(2) var<uniform> lighting: Lighting;

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let distance = textureSample(field, linear_sampler, uv).g;
  let unit = min(lighting.size.x, lighting.size.y);
  let point = (uv - 0.5) * lighting.size / unit;
  let delta = point - lighting.light;
  let spot = exp(-dot(delta, delta) / 0.033);
  let edge = exp(-abs(distance) / 0.85);
  let energy = edge * (0.3 + spot * 4.5);
  return vec4f(vec3f(energy), 1.0);
}
