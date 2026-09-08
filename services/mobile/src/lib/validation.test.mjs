import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isEmail, validateEmail, validateNewPassword, validatePhone, validateRequired } from './validation.ts';

describe('form validation', () => {
  it('accepts a trimmed email and rejects incomplete addresses', () => {
    assert.equal(isEmail(' sagar@example.com '), true);
    assert.equal(validateEmail('sagar@example.com'), undefined);
    assert.equal(validateEmail('sagar@'), 'Enter a valid email address.');
  });

  it('requires values and passwords of at least eight characters', () => {
    assert.equal(validateRequired('  ', 'Name'), 'Name is required.');
    assert.equal(validateNewPassword('short'), 'Use at least 8 characters.');
    assert.equal(validateNewPassword('long-enough'), undefined);
  });

  it('accepts common New Zealand phone formats', () => {
    assert.equal(validatePhone('+64 21 123 4567'), undefined);
    assert.equal(validatePhone('09 123 4567'), undefined);
    assert.equal(validatePhone('12345'), 'Enter a valid New Zealand phone number.');
  });
});
