import pino from "pino";

export type Logger = pino.Logger;

// One level of wildcard covers today's call sites; revisit if a real log call ever needs to
// redact something nested deeper than `<field>.secretKey`.
const REDACT_PATHS = [
  "password",
  "token",
  "secret",
  "apiKey",
  "api_key",
  "authorization",
  "accessToken",
  "access_token",
  "*.password",
  "*.token",
  "*.secret",
  "*.apiKey",
  "*.api_key",
  "*.authorization",
  "*.accessToken",
  "*.access_token",
];

export function createLogger(name: string, destination?: pino.DestinationStream): Logger {
  const options: pino.LoggerOptions = {
    name,
    level: process.env.LOG_LEVEL ?? "info",
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
  };
  // Pino writes through sonic-boom straight to a file descriptor by default, bypassing
  // `process.stdout.write` entirely — tests inject a plain Writable here to observe output.
  return destination ? pino(options, destination) : pino(options);
}
