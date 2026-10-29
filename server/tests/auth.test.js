import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPassword,
  verifyPassword,
  createToken,
  verifyToken,
  sanitizeUser
} from '../auth.js';

describe('Authentication & Cryptography Unit Tests', () => {
  test('Password hashing generates distinct salt and verifiable scrypt hash', () => {
    const password = 'StrongPassword123!';
    const { hash, salt } = hashPassword(password);

    assert.ok(hash && typeof hash === 'string', 'Hash should be a non-empty string');
    assert.ok(salt && typeof salt === 'string', 'Salt should be a non-empty string');

    // Correct password verifies successfully
    const isValid = verifyPassword(password, hash, salt);
    assert.equal(isValid, true, 'Valid password should verify as true');

    // Incorrect password rejected
    const isInvalid = verifyPassword('WrongPassword!', hash, salt);
    assert.equal(isInvalid, false, 'Invalid password should verify as false');

    // Salting produces unique hashes for identical passwords
    const second = hashPassword(password);
    assert.notEqual(hash, second.hash, 'Hashes of identical passwords with different salts must differ');
  });

  test('JWT creation and timing-safe signature verification', () => {
    const payload = { id: 'usr_test_123', email: 'patient@example.com', name: 'John Doe', role: 'PATIENT' };
    const token = createToken(payload);

    assert.ok(token && token.split('.').length === 3, 'Token must have header.body.signature format');

    const decoded = verifyToken(token);
    assert.ok(decoded, 'Token should verify successfully');
    assert.equal(decoded.id, payload.id);
    assert.equal(decoded.email, payload.email);
    assert.equal(decoded.name, payload.name);
    assert.equal(decoded.role, payload.role);
    assert.ok(decoded.exp > Math.floor(Date.now() / 1000), 'Token expiration must be in the future');
  });

  test('JWT rejects tampered payloads and signatures', () => {
    const payload = { id: 'usr_legit', email: 'legit@example.com' };
    const token = createToken(payload);
    const [header, body, sig] = token.split('.');

    // Tampered body
    const forgedBody = Buffer.from(JSON.stringify({ id: 'usr_admin', role: 'ADMIN' })).toString('base64url');
    const tamperedToken = `${header}.${forgedBody}.${sig}`;
    const resultTampered = verifyToken(tamperedToken);
    assert.equal(resultTampered, null, 'Tampered token must be rejected');

    // Tampered signature
    const forgedSig = sig.slice(0, -3) + 'xyz';
    const invalidSigToken = `${header}.${body}.${forgedSig}`;
    const resultInvalidSig = verifyToken(invalidSigToken);
    assert.equal(resultInvalidSig, null, 'Invalid signature must be rejected');
  });

  test('sanitizeUser strips passwordHash and salt', () => {
    const rawUser = {
      id: 'usr_99',
      name: 'Alice Smith',
      email: 'alice@example.com',
      passwordHash: 'secret_hash_value',
      salt: 'secret_salt_value',
      diagnosis: 'Post-op recovery'
    };

    const sanitized = sanitizeUser(rawUser);
    assert.equal(sanitized.id, 'usr_99');
    assert.equal(sanitized.name, 'Alice Smith');
    assert.equal(sanitized.passwordHash, undefined, 'passwordHash must be stripped');
    assert.equal(sanitized.salt, undefined, 'salt must be stripped');
  });
});
