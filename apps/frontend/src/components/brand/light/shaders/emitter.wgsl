import { Shape } from "./contracts.wgsl";
@group(0) @binding(0) var field: texture_2d<f32>;
@group(0) @binding(1) var<storage, read> shapes: array<Shape>;

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let pixel = vec2i(uv * vec2f(textureDimensions(field)));
  let distances = textureLoad(field, pixel, 0);
  let logo = 1.0 - smoothstep(-0.75, 0.75, distances.g);
  // Every original logo stroke emits its own color and blocks light behind it.
  let emission = shapes[u32(distances.b + 0.5)].color.rgb * 2.0 * logo;
  return vec4f(emission, logo);
}
