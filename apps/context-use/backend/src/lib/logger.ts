import pino, { type DestinationStream, type LevelWithSilent } from 'pino';

export type Logger = pino.Logger;

const SECRET_FIELDS = [
  'authorization',
  'cookie',
  'set-cookie',
  'password',
  'secret',
  'client_secret',
  'clientSecret',
  'client_assertion',
  'id_token',
  'apiKey',
  'api_key',
  'access_token',
  'accessToken',
  'refresh_token',
  'refreshToken',
  'token',
  'code',
  'code_verifier',
];

export function createLogger({
  scope = 'backend',
  level = 'info',
  destination = { write: (line: string) => process.stdout.write(line) },
}: {
  scope?: string;
  level?: LevelWithSilent;
  destination?: DestinationStream;
} = {}): Logger {
  return pino(
    {
      level,
      base: { name: scope },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      redact: SECRET_FIELDS.flatMap((field) => [`["${field}"]`, `*["${field}"]`]),
    },
    {
      write(line) {
        try {
          destination.write(line);
        } catch {
          // An unavailable sink must not turn successful application work into a failure.
        }
      },
    },
  );
}
