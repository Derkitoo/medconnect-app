import { env } from 'cloudflare:workers';

export function getDb() {
  if (!env.DB) throw new Error('La synchronisation est temporairement indisponible.');
  return env.DB;
}
