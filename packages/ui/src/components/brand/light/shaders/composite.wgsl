@group(0) @binding(0) var field: texture_2d<f32>;
@group(0) @binding(1) var irradiance: texture_2d<f32>;
@group(0) @binding(3) var rim: texture_2d<f32>;
@group(0) @binding(4) var blurred_rim: texture_2d<f32>;
@group(0) @binding(5) var linear_sampler: sampler;
@group(0) @binding(6) var rays_texture: texture_2d<f32>;

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let dimensions = vec2f(textureDimensions(field));
  let unit = min(dimensions.x, dimensions.y);
  let distances = textureSample(field, linear_sampler, uv);
  let logo = 1.0 - smoothstep(-0.5, 0.5, distances.g);
  let rays = textureSample(rays_texture, linear_sampler, uv).rgb;
  let sharp = textureSample(rim, linear_sampler, uv).rgb;
  let soft = textureSample(blurred_rim, linear_sampler, uv).rgb;
  let light = textureSample(irradiance, linear_sampler, uv).rgb;
  let local_glow = exp(-max(distances.g, 0.0) / (unit * 0.16));
  var color = vec3f(0.002, 0.0025, 0.004);
  color += light * (0.01 + local_glow * 0.045) * (1.0 - logo);
  color += sharp * 1.05 + soft * 0.2 + rays * 0.9 * (1.0 - logo);
  color += vec3f(0.004) * logo;
  let tone = vec3f(1.0) - exp(-color * 1.3);
  return vec4f(pow(tone, vec3f(0.85)), 1.0);
}
