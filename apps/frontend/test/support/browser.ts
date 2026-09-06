import { afterEach } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import type { Screen } from '@testing-library/react';

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: 'http://localhost' });
}

const testingLibrary = await import('@testing-library/react');

afterEach(testingLibrary.cleanup);

export const { render, waitFor } = testingLibrary;
export const screen: Screen = testingLibrary.screen;
export const userEvent = (await import('@testing-library/user-event')).default;
