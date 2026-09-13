struct Blur { direction: vec2f, padding: vec2f };
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var linear_sampler: sampler;
@group(0) @binding(2) var<uniform> blur: Blur;

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let step = blur.direction / vec2f(textureDimensions(source));
  var color = textureSample(source, linear_sampler, uv) * 0.227027;
  color += textureSample(source, linear_sampler, uv + step * 1.384615) * 0.316216;
  color += textureSample(source, linear_sampler, uv - step * 1.384615) * 0.316216;
  color += textureSample(source, linear_sampler, uv + step * 3.230769) * 0.070270;
  color += textureSample(source, linear_sampler, uv - step * 3.230769) * 0.070270;
  return color;
}
