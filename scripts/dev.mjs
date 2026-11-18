#!/usr/bin/env node
/**
 * Lokalny development: Worker z API (wrangler dev, lokalne D1 i KV na :8787)
 * + Vite (:5173), który przekierowuje do niego /api i /media.
 *   Sklep:  http://localhost:5173/
 *   Panel:  http://localhost:5173/admin/   (hasło z .dev.vars → ADMIN_PASSWORD)
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';

// wrangler wymaga katalogu assets z wrangler.jsonc, nawet gdy statykę serwuje Vite.
if (!existsSync('dist')) mkdirSync('dist');
if (!existsSync('.dev.vars')) console.warn('! Brak .dev.vars – skopiuj .dev.vars.example, żeby zalogować się do panelu.');

const run = (args) => spawn('npx', args, { stdio: 'inherit', shell: process.platform === 'win32' });
const children = [run(['wrangler', 'dev', '--port', '8787', '--ip', '127.0.0.1', '--show-interactive-dev-session=false']), run(['vite'])];

const stop = () => children.forEach((child) => child.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
children.forEach((child) => child.on('exit', (code) => {
  stop();
  process.exitCode = code ?? 0;
}));
