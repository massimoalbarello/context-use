import { rc_atlas_texel } from './rc-directions.wgsl';
@group(0) @binding(0) var cascade: texture_2d<f32>;
@group(0) @binding(1) var field: texture_2d<f32>;

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let pixel = floor(uv * vec2f(textureDimensions(field)));
  var total = vec3f(0.0);
  for (var ray = 0.0; ray < 4.0; ray += 1.0) {
    total += textureLoad(cascade, vec2i(rc_atlas_texel(pixel, ray, 2.0)), 0).rgb;
  }
  return vec4f(total * 0.25, 1.0);
}
