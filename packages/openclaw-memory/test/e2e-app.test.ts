import { expect, test } from 'bun:test';
import { reservePort } from '../scripts/e2e-app';

test('test services hold distinct ports until their reservations are released', async () => {
  using gateway = reservePort();
  using backend = reservePort();
  using frontend = reservePort();
  const port = gateway.port!;
  const ports = [port, backend.port, frontend.port];
  expect(new Set(ports).size).toBe(ports.length);
  expect(() => Bun.serve({ port, fetch: () => new Response() })).toThrow(
    expect.objectContaining({ code: 'EADDRINUSE' }),
  );
  expect((await fetch(`http://localhost:${port}/readyz`)).ok).toBe(false);

  await gateway.stop(true);
  using service = Bun.serve({ port, fetch: () => new Response('ready') });
  expect(await (await fetch(`http://localhost:${service.port}/readyz`)).text()).toBe('ready');
});

test('a startup failure releases its port reservation', () => {
  let port = 0;
  expect(() => {
    using reservation = reservePort();
    port = reservation.port!;
    throw new Error('startup failed');
  }).toThrow('startup failed');

  using service = Bun.serve({ port, fetch: () => new Response() });
  expect(service.port).toBe(port);
});
