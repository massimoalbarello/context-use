import { effect, frame, type Gpu, type Surface, sampler, storage, target } from 'vgpu';
import { type Point, packShapes, type Shape } from './logo';
import blurShader from './shaders/blur.wgsl';
import compositeShader from './shaders/composite.wgsl';
import emitterShader from './shaders/emitter.wgsl';
import fieldShader from './shaders/field.wgsl';
import cascadeShader from './shaders/radiance-cascade.wgsl';
import raysShader from './shaders/rays.wgsl';
import resolveShader from './shaders/resolve.wgsl';
import rimShader from './shaders/rim.wgsl';

const CASCADE_COUNT = 6;
const CASCADE_ALIGNMENT = 2 ** (CASCADE_COUNT - 1);
const ATLAS_SCALE = 2;
const MAX_FIELD_DIMENSION = 768;
const FLOATS_PER_SHAPE = 8;
const HDR_FORMAT = 'rgba16float';
const BLUR_STEP = 1;

export function createPipeline({
  gpu,
  output,
  shapes,
}: {
  gpu: Gpu;
  output: Surface;
  shapes: readonly Shape[];
}) {
  const makeTarget = () => target(gpu, { size: [1, 1], format: HDR_FORMAT });
  const field = makeTarget();
  const outlineField = makeTarget();
  const emitter = makeTarget();
  const irradiance = makeTarget();
  const rim = makeTarget();
  const rays = makeTarget();
  const blurHorizontal = makeTarget();
  const blurVertical = makeTarget();
  const cascades = [makeTarget(), makeTarget()] as const;
  const linearSampler = sampler(gpu, { minFilter: 'linear', magFilter: 'linear' });
  const shaders = {
    field: effect(gpu, fieldShader),
    outlineField: effect(gpu, fieldShader),
    emitter: effect(gpu, emitterShader),
    resolve: effect(gpu, resolveShader),
    rim: effect(gpu, rimShader),
    rays: effect(gpu, raysShader),
    blurH: effect(gpu, blurShader),
    blurV: effect(gpu, blurShader),
    composite: effect(gpu, compositeShader),
    cascades: Array.from({ length: CASCADE_COUNT }, () => effect(gpu, cascadeShader)),
  };
  const buffer = storage(
    gpu,
    shapes.length * FLOATS_PER_SHAPE * Float32Array.BYTES_PER_ELEMENT,
    'read',
  );
  buffer.write(packShapes(shapes));
  shaders.field.set({ shapes: buffer });
  shaders.outlineField.set({ shapes: buffer });
  shaders.emitter.set({ shapes: buffer });
  shaders.rim.set({ shapes: buffer });

  const prepare = () =>
    Promise.all([
      ...[
        shaders.field,
        shaders.outlineField,
        shaders.emitter,
        shaders.resolve,
        shaders.rim,
        shaders.rays,
        shaders.blurH,
        shaders.blurV,
        ...shaders.cascades,
      ].map((shader) => shader.compile({ colors: [HDR_FORMAT] })),
      shaders.composite.compile({ colors: [output.format] }),
    ]);

  let pixelRatio = 1;
  const resize = ({ size, ratio }: { size: Point; ratio: number }) => {
    pixelRatio = ratio;
    output.resize(size);
    const scale = Math.min(1, MAX_FIELD_DIMENSION / Math.max(...size));
    const fieldSize: Point = [
      Math.max(1, Math.round(size[0] * scale)),
      Math.max(1, Math.round(size[1] * scale)),
    ];
    const atlasSize: Point = [
      Math.ceil(fieldSize[0] / CASCADE_ALIGNMENT) * CASCADE_ALIGNMENT * ATLAS_SCALE,
      Math.ceil(fieldSize[1] / CASCADE_ALIGNMENT) * CASCADE_ALIGNMENT * ATLAS_SCALE,
    ];
    for (const resource of [field, emitter, irradiance, rays]) {
      resource.resize(fieldSize);
    }
    for (const resource of cascades) {
      resource.resize(atlasSize);
    }
    // Keep the logo geometry sharp independently of the diffuse-light resolution.
    for (const resource of [outlineField, rim, blurHorizontal, blurVertical]) {
      resource.resize(size);
    }
    shaders.emitter.set({ field });
    shaders.resolve.set({ field });
    shaders.rim.set({ field: outlineField, linear_sampler: linearSampler });
    shaders.blurH.set({
      source: rim,
      linear_sampler: linearSampler,
      blur: { direction: [BLUR_STEP * pixelRatio, 0], padding: [0, 0] },
    });
    shaders.blurV.set({
      source: blurHorizontal,
      linear_sampler: linearSampler,
      blur: { direction: [0, BLUR_STEP * pixelRatio], padding: [0, 0] },
    });
    shaders.composite.set({
      field: outlineField,
      irradiance,
      rim,
      blurred_rim: blurVertical,
      linear_sampler: linearSampler,
      rays_texture: rays,
    });
    shaders.rays.set({ blurred_rim: blurVertical, linear_sampler: linearSampler });
  };

  const render = ({ light, sceneChanged }: { light: Point; sceneChanged: boolean }) => {
    const lighting = { light, size: output.size, pixel_ratio: pixelRatio };
    shaders.rim.set({ lighting });
    shaders.rays.set({ lighting });
    shaders.field.set({ scene: { size: field.size, count: shapes.length, padding: 0 } });
    shaders.outlineField.set({ scene: { size: output.size, count: shapes.length, padding: 0 } });
    let upper = cascades[0];
    let destination = cascades[1];
    const cascadePasses = Array.from(shaders.cascades.entries(), ([index, shader]) => {
      const level = CASCADE_COUNT - index - 1;
      shader.set({
        rc: { state: [level, index > 0 ? 1 : 0, 0, 0] },
        sdf_tex: field,
        sdf_samp: linearSampler,
        emitter_tex: emitter,
        emitter_samp: linearSampler,
        upper_tex: upper,
      });
      const pass = { shader, target: destination };
      [upper, destination] = [destination, upper];
      return pass;
    });
    shaders.resolve.set({ cascade: upper });
    frame(gpu, (current) => {
      if (sceneChanged) {
        current.pass({ target: outlineField }, (pass) => pass.draw(shaders.outlineField));
        current.pass({ target: field }, (pass) => pass.draw(shaders.field));
        current.pass({ target: emitter }, (pass) => pass.draw(shaders.emitter));
        for (const cascade of cascadePasses) {
          current.pass({ target: cascade.target }, (pass) => pass.draw(cascade.shader));
        }
        current.pass({ target: irradiance }, (pass) => pass.draw(shaders.resolve));
      }
      current.pass({ target: rim }, (pass) => pass.draw(shaders.rim));
      current.pass({ target: blurHorizontal }, (pass) => pass.draw(shaders.blurH));
      current.pass({ target: blurVertical }, (pass) => pass.draw(shaders.blurV));
      current.pass({ target: rays }, (pass) => pass.draw(shaders.rays));
      current.pass({ target: output }, (pass) => pass.draw(shaders.composite));
    });
  };

  return { prepare, resize, render };
}
