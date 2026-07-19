import { isValidCreditCard, isPIIPhone, isSSN } from '../helpers/pii-functions';

describe('PII Detection Functions', () => {
  describe('isValidCreditCard', () => {
    it('returns true for a valid Visa test card', () => {
      expect(isValidCreditCard('4111111111111111')).toBe(true);
    });
    it('returns false for an invalid Luhn number', () => {
      expect(isValidCreditCard('1234567890123456')).toBe(false);
    });
    it('returns true for a valid card with spaces', () => {
      expect(isValidCreditCard('4111 1111 1111 1111')).toBe(true);
    });
  });

  describe('isPIIPhone', () => {
    it('returns true for valid 10-digit US phone', () => {
      expect(isPIIPhone('2125551234')).toBe(true);
    });
    it('returns false for a 9-digit phone', () => {
      expect(isPIIPhone('123456789')).toBe(false);
    });
  });

  describe('isSSN', () => {
    it('returns true for valid formatted SSN', () => {
      expect(isSSN('123-45-6789')).toBe(true);
    });
    it('returns false for invalid area', () => {
      expect(isSSN('000-45-6789')).toBe(false);
      expect(isSSN('666-45-6789')).toBe(false);
      expect(isSSN('901-45-6789')).toBe(false);
    });
  });
});
