const { parsePhoneNumberFromString } = require('libphonenumber-js');

/**
 * Validates a user-entered phone number and converts it to E.164
 * (e.g. "+15551234567") whenever possible.
 */
function validateAndFormatPhone(rawInput) {
  const input = rawInput.trim();

  // If they forgot the leading '+', add it so the parser can work with a
  // consistent international format. We do NOT guess a default country -
  // guessing wrong could dial the wrong country's number entirely.
  const candidate = input.startsWith('+') ? input : `+${input.replace(/[^\d]/g, '')}`;

  const phoneNumber = parsePhoneNumberFromString(candidate);

  if (!phoneNumber || !phoneNumber.isValid()) {
    return {
      valid: false,
      error:
        "That doesn't look like a valid phone number. Please include the country code, " +
        'for example +1 555 123 4567 (US) or +44 7911 123456 (UK).',
    };
  }

  return { valid: true, e164: phoneNumber.number };
}

module.exports = { validateAndFormatPhone };
