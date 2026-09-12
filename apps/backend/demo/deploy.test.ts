import { expect, test } from 'bun:test';
import { demoDeploymentTarget } from './deploy';

const personalApps = [{ slug: 'context-use-private' }, { slug: 'steve-jobs-demonstration' }];

test('a first demo deploy never selects a personal app', () => {
  expect(demoDeploymentTarget(personalApps)).toEqual(['--name', 'steve-jobs-demo']);
});

test('redeploy selects the exact demo slug, never a personal app', () => {
  for (const slug of ['steve-jobs-demo', 'steve-jobs-demo-abc123']) {
    expect(demoDeploymentTarget([...personalApps, { slug }])).toEqual(['--app', slug]);
  }
});

test('an ambiguous demo target stops deployment', () => {
  expect(() =>
    demoDeploymentTarget([{ slug: 'steve-jobs-demo-one' }, { slug: 'steve-jobs-demo-two' }]),
  ).toThrow('Multiple Steve Jobs demos found');
});
