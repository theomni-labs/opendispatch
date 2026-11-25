export const REALM: string;
export const CLIENT_ID: string;
export const SECRET_ENV: 'OPENDISPATCH_KC_CLIENT_SECRET';
export interface KeycloakState {
  readonly OPENDISPATCH_KC_PORT: string;
  readonly OPENDISPATCH_KC_PROJECT?: string;
  readonly OPENDISPATCH_KC_PUBLIC_URL?: string;
  readonly OPENDISPATCH_KC_BOOTSTRAP_PASSWORD?: string;
  readonly OPENDISPATCH_KC_CLIENT_SECRET?: string;
  readonly OPENDISPATCH_KC_REDIRECTS?: string;
  readonly issuer: string;
}
export interface DemoUser {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly groups: readonly string[];
  readonly role: string;
}
export function generatePassword(length?: number): string;
export function demoUsers(): DemoUser[];
export function localBase(state: KeycloakState): string;
export function frontBase(state: KeycloakState): string;
export function readState(dir: string): KeycloakState | null;
export function readLogins(dir: string): Map<string, string>;
export function readAccounts(dir: string): Map<string, { password: string; totp?: string }>;
export function base32(bytes: Uint8Array): string;
export function fromBase32(text: string): Buffer;
export function needsAuthenticator(username: string): boolean;
export function tenantsJson(state: KeycloakState, web: string, tenantId: string): Array<Record<string, unknown>>;
