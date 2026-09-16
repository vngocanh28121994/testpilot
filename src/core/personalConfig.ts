import { existsSync } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface PersonalConfigProfile {
  file: string;
  owner: string;
  source: 'personal' | 'environment';
}

/** Stable, path-safe identity for the local OS account running TestPilot. */
export function configOwner(username = os.userInfo().username): string {
  return username.trim() || 'local-user';
}

function ownerSlug(username: string): string {
  return username
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'local-user';
}

/**
 * One config per local user and workspace. Relative project paths continue to
 * resolve against the repo, while two OS accounts no longer overwrite the same
 * settings. TESTPILOT_CONFIG remains the explicit escape hatch for CI/scripts.
 */
export function personalConfigProfile(
  workspace = process.cwd(),
  username = configOwner(),
  override = process.env.TESTPILOT_CONFIG,
): PersonalConfigProfile {
  if (override?.trim()) {
    return { file: path.resolve(workspace, override), owner: username, source: 'environment' };
  }
  return {
    file: path.join(workspace, '.testpilot', 'users', ownerSlug(username), 'config.json'),
    owner: username,
    source: 'personal',
  };
}

/** Seed a new personal profile from the existing workspace config once. */
export async function ensurePersonalConfig(
  profile: PersonalConfigProfile,
  workspace = process.cwd(),
): Promise<PersonalConfigProfile> {
  if (existsSync(profile.file)) return profile;
  if (profile.source === 'environment') return profile;
  await mkdir(path.dirname(profile.file), { recursive: true });
  const seed = path.join(workspace, 'testpilot.config.json');
  if (!existsSync(seed)) return profile;
  await copyFile(seed, profile.file);
  return profile;
}
