import bcrypt from 'bcrypt';

const BCRYPT_COST = 12;

/**
 * @param plain a plaintext password
 * @returns a salted bcrypt hash of `plain` (the salt is embedded in the returned string --
 *          no separate salt storage needed)
 */
export function hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_COST);
}

/**
 * @param plain a plaintext password attempt
 * @param hash a hash previously produced by hashPassword
 * @returns true iff `plain` hashes to `hash`
 */
export function verifyPassword(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
}
