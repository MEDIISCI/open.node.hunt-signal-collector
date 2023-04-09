export const ErrorCode = Object.freeze({
	UNKOWN_ERROR: 'core#unknown-error',

	UNAUTHORIZED_ACCESS: 'auth#unauthorized',
	ACCOUNT_NOT_FOUND: 'auth#account-not-found',
	INVALID_PASSWORD: 'auth#invalid-password',
	INVALID_PAYLOAD_FORMAT: 'parse#invalid-error-format',

	STRATEGY_NOT_FOUND: 'error#strategy-not-found',
	MISSING_REQUIRED_FIELDS: 'error#missing-required-fields',
	INVALID_PAYLOAD_CONTENTS: 'error#invalid-payload-content'
} as const);

export type ErrorCodes = typeof ErrorCode[keyof typeof ErrorCode];