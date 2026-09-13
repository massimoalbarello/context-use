import { Lighting, Shape } from "./contracts.wgsl";
@group(0) @binding(0) var field: texture_2d<f32>;
@group(0) @binding(1) var linear_sampler: sampler;
@group(0) @binding(2) var<uniform> lighting: Lighting;
@group(0) @binding(3) var<storage, read> shapes: array<Shape>;

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let distance = textureSample(field, linear_sampler, uv).g;
  let dimensions = vec2f(textureDimensions(field));
  let texel = vec2i(clamp(uv * dimensions, vec2f(0.0), dimensions - 1.0));
  let shape_index = u32(textureLoad(field, texel, 0).b + 0.5);
  let color = shapes[shape_index].color.rgb;
  let unit = min(lighting.size.x, lighting.size.y);
  let point = (uv - 0.5) * lighting.size / unit;
  // Keep the highlight on the mark even when the beam target is over the form.
  let highlight = lighting.light / max(1.0, length(lighting.light) / 0.22);
  let delta = point - highlight;
  let spot = exp(-dot(delta, delta) / 0.033);
  let edge = exp(-abs(distance) / (0.85 * lighting.pixel_ratio));
  let energy = edge * (0.9 + spot * 3.5);
  return vec4f(color * energy, 1.0);
}
