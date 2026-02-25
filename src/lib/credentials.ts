import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Credentials {
  jwt: string;
  username: string;
  tenant_id: string;
  gateway_token?: string;
  instance_domain?: string;
  jwt_expires_at?: string;
}

const CONFIG_DIR = join(homedir(), ".starkbot-cli");
const CREDS_FILE = join(CONFIG_DIR, "credentials.json");

function ensureDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

export function loadCredentials(): Credentials | null {
  try {
    if (!existsSync(CREDS_FILE)) return null;
    const raw = readFileSync(CREDS_FILE, "utf-8");
    return JSON.parse(raw) as Credentials;
  } catch {
    return null;
  }
}

export function saveCredentials(creds: Credentials): void {
  ensureDir();
  writeFileSync(CREDS_FILE, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

export function updateCredentials(partial: Partial<Credentials>): void {
  const existing = loadCredentials();
  if (!existing) throw new Error("No credentials stored. Run `starkbot login` first.");
  saveCredentials({ ...existing, ...partial });
}

export function clearCredentials(): void {
  try {
    if (existsSync(CREDS_FILE)) unlinkSync(CREDS_FILE);
  } catch {
    // ignore
  }
}

/** Check if the stored JWT is expired (with 5 min buffer) */
export function isJwtExpired(creds: Credentials): boolean {
  if (!creds.jwt) return true;
  try {
    // Decode JWT payload (base64url)
    const parts = creds.jwt.split(".");
    if (parts.length !== 3) return true;
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8")
    );
    const exp = payload.exp as number;
    if (!exp) return true;
    // Expired if within 5 minutes of expiry
    return Date.now() / 1000 > exp - 300;
  } catch {
    return true;
  }
}

/** Get credentials or throw with helpful message */
export function requireCredentials(): Credentials {
  const creds = loadCredentials();
  if (!creds) {
    throw new Error("Not logged in. Run `starkbot login` first.");
  }
  if (isJwtExpired(creds)) {
    throw new Error("Session expired. Run `starkbot login` to re-authenticate.");
  }
  return creds;
}
