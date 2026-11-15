const ALLOWLISTED_ERROR_CODES = new Set([
  'invalid_grant',
  'invalid_token',
  'invalid_client',
  'invalid_request',
  'invalid_api_key',
  'unauthorized_client',
  'access_denied',
  'authentication_error',
  'permission_error',
  'insufficient_quota',
  'rate_limit_error',
  'rate_limit_exceeded',
  'usage_limit_reached',
  'overloaded_error',
  'api_error',
  'server_error',
  'not_found_error',
  'model_not_found',
  'invalid_request_error',
  'context_length_exceeded',
  'request_too_large',
  'unauthorized',
  'forbidden',
  'expired',
  'revoked',
  'overloaded',
  'timeout',
  'aborted',
  'quota',
  'unavailable',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN',
])

export function classifyWithoutProviderText(stopReason: string, message = '') {
  const parts = [stopReason]
  const status = /^\s*([45]\d\d)\b|\b(?:status|http)[\s:=]*([45]\d\d)\b/i.exec(message)
  if (status) parts.push(status[1] ?? status[2])
  for (const word of message.split(/[^A-Za-z_]+/)) {
    const code = ALLOWLISTED_ERROR_CODES.has(word)
      ? word
      : ALLOWLISTED_ERROR_CODES.has(word.toLowerCase())
        ? word.toLowerCase()
        : ''
    if (code && !parts.includes(code)) parts.push(code)
    if (parts.length >= 5) break
  }
  return parts.join(' ')
}
