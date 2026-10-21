import crypto from 'node:crypto';
import pino from 'pino';

export const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'req.headers["x-csrf-token"]',
      '*.password',
      '*.password_hash',
      '*.token',
      '*.secret',
      '*.key',
      '*_enc',
      '*.image'
    ],
    censor: '[REDACTED]'
  }
});

export function errorHandler(err, req, res, next) {
  const requestId = req.id || crypto.randomUUID();

  // Log error details securely on the server
  logger.error({
    requestId,
    url: req.originalUrl,
    method: req.method,
    message: err.message,
    stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined
  }, 'Unhandled request error');

  if (res.headersSent) {
    return next(err);
  }

  // Rate limit / custom status codes
  const statusCode = err.status || err.statusCode || 500;
  
  if (statusCode >= 400 && statusCode < 500) {
    return res.status(statusCode).json({
      error: err.message || 'Client error',
      requestId
    });
  }

  // Never expose internal error messages or SQL traces to the client
  res.status(500).json({
    error: 'An internal server error occurred',
    requestId
  });
}

export default errorHandler;
