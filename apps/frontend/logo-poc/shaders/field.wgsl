import { Shape } from "./contracts.wgsl";
struct Scene { size: vec2f, count: u32, padding: u32 };
@group(0) @binding(0) var<uniform> scene: Scene;
@group(0) @binding(1) var<storage, read> shapes: array<Shape>;

fn box_distance(p: vec2f, rectangle: vec4f) -> f32 {
  let q = abs(p - rectangle.xy) - rectangle.zw;
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0);
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let unit = min(scene.size.x, scene.size.y);
  let point = (uv - 0.5) * scene.size / unit;
  var logo_distance = 10000.0;
  var stroke_distance = 10000.0;
  var closest = 0.0;
  for (var i = 0u; i < scene.count; i++) {
    let shape = shapes[i];
    let distance = box_distance(point, shape.rectangle) * unit;
    if (shape.color.a > 0.5) {
      logo_distance = min(logo_distance, distance);
    } else if (distance < stroke_distance) {
      stroke_distance = distance;
      closest = f32(i);
    }
  }
  return vec4f(max(0.0, min(logo_distance, stroke_distance)), logo_distance, stroke_distance, closest);
}
