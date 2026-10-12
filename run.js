#!/usr/bin/env node
import { spawn, execSync } from 'node:child_process';
import { existsSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isWindows = process.platform === 'win32';

// ANSI escape codes
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

console.log(`
${BOLD}${CYAN}===============================================================${RESET}
${BOLD}${CYAN}               CodeQuest — Contest Platform                    ${RESET}
${BOLD}${CYAN}===============================================================${RESET}
`);

// 1. Check & ensure environment files
const serverEnv = resolve(__dirname, 'server', '.env');
const serverEnvExample = resolve(__dirname, 'server', '.env.example');
if (!existsSync(serverEnv) && existsSync(serverEnvExample)) {
  console.log(`${YELLOW}[setup] Creating server/.env from .env.example...${RESET}`);
  copyFileSync(serverEnvExample, serverEnv);
}

const clientEnv = resolve(__dirname, 'client', '.env');
const clientEnvExample = resolve(__dirname, 'client', '.env.example');
if (!existsSync(clientEnv) && existsSync(clientEnvExample)) {
  console.log(`${YELLOW}[setup] Creating client/.env from .env.example...${RESET}`);
  copyFileSync(clientEnvExample, clientEnv);
}

// 2. Ensure database migrations are applied
try {
  console.log(`${CYAN}[database] Checking and applying database migrations...${RESET}`);
  execSync('npm run db:migrate', { cwd: __dirname, stdio: 'inherit' });
} catch {
  console.log(`${YELLOW}[warning] Database migration check encountered an issue.${RESET}`);
}

console.log(`${GREEN}✔${RESET} Client App:    ${BOLD}http://localhost:5173${RESET}`);
console.log(`${GREEN}✔${RESET} Server API:    ${BOLD}http://localhost:5050${RESET}`);
console.log(`${GREEN}✔${RESET} Admin Login:   ${BOLD}http://localhost:5173/admin/login${RESET}`);
console.log(`${DIM}  Default Admin: admin@codequest.local / ChangeMe_12345${RESET}`);
console.log(`\n${CYAN}Starting backend server and frontend client concurrently...${RESET}`);
console.log(`${DIM}Press Ctrl+C at any time to stop all services.${RESET}\n`);

const children = [];

function killChild(child) {
  if (!child || !child.pid) return;
  try {
    if (isWindows) {
      execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
    } else {
      process.kill(-child.pid, 'SIGINT');
    }
  } catch {
    // Process may have already exited
  }
}

function cleanup() {
  console.log(`\n${YELLOW}Shutting down CodeQuest services...${RESET}`);
  for (const child of children) {
    killChild(child);
  }
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', () => {
  for (const child of children) {
    killChild(child);
  }
});

// Helper to spawn and pipe output with prefix
function runService(name, script, color) {
  const child = spawn(`npm run ${script}`, {
    cwd: __dirname,
    shell: true,
    stdio: ['inherit', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '1' }
  });

  children.push(child);

  const prefix = `${color}[${name}]${RESET} `;

  child.stdout.on('data', (data) => {
    const lines = data.toString().split(/\r?\n/);
    for (const line of lines) {
      if (line.trim().length > 0) {
        process.stdout.write(prefix + line + '\n');
      }
    }
  });

  child.stderr.on('data', (data) => {
    const lines = data.toString().split(/\r?\n/);
    for (const line of lines) {
      if (line.trim().length > 0) {
        process.stderr.write(prefix + line + '\n');
      }
    }
  });

  child.on('close', (code) => {
    if (code !== null && code !== 0) {
      console.log(`${color}[${name}]${RESET} exited with code ${code}`);
    }
  });

  return child;
}

// Start backend
runService('server', 'dev:server', CYAN);

// Start frontend
runService('client', 'dev:client', GREEN);
