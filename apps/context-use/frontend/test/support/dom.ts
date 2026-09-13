import { afterEach, beforeEach } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost' });

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());
