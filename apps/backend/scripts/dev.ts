import {
  BACKEND_ENTRYPOINT,
  DB_MIGRATIONS_DIR_NAME,
  DB_MIGRATIONS_DIR_NAME_CONSTANT_NAME,
  PUBLIC_FRONTEND_DIR_NAME_CONSTANT_NAME,
} from './shared/constants';

// Vite owns the frontend during development. Pointing the backend at a deliberately absent folder
// prevents an old production build in `public` from exposing a second, stale application origin.
const DEV_PUBLIC_FRONTEND_DIR_NAME = '.frontend-served-by-vite';

const proc = Bun.spawn(
  [
    'bun',
    'run',
    // Ties the server's lifetime to this wrapper: Ctrl-C or a killed parent takes the
    // server down with it instead of leaving :3000 held by an orphan.
    '--no-orphans',
    '--define',
    `${PUBLIC_FRONTEND_DIR_NAME_CONSTANT_NAME}="${DEV_PUBLIC_FRONTEND_DIR_NAME}"`,
    '--define',
    `${DB_MIGRATIONS_DIR_NAME_CONSTANT_NAME}="${DB_MIGRATIONS_DIR_NAME}"`,
    BACKEND_ENTRYPOINT,
  ],
  // stdio is inherited so the child keeps the terminal (TTY) and its output stays colored
  { stdio: ['inherit', 'inherit', 'inherit'] },
);

process.exit(await proc.exited);
