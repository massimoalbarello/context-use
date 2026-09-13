import { Shape } from "./contracts.wgsl";
@group(0) @binding(0) var field: texture_2d<f32>;
@group(0) @binding(1) var<storage, read> shapes: array<Shape>;

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let pixel = vec2i(uv * vec2f(textureDimensions(field)));
  let distances = textureLoad(field, pixel, 0);
  let stroke = 1.0 - smoothstep(-0.75, 0.75, distances.b);
  let logo = 1.0 - smoothstep(-0.75, 0.75, distances.g);
  // The logo is an opaque obstacle. Colored strokes illuminate its surroundings.
  let emission = shapes[u32(distances.a + 0.5)].color.rgb * 4.0 * stroke * (1.0 - logo);
  return vec4f(emission, max(stroke, logo));
}
