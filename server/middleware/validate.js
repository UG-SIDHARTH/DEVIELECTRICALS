export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: result.error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message
        }))
      });
    }
    req.validatedBody = result.data;
    next();
  };
}

export function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return res.status(400).json({
        error: 'Invalid query parameters',
        details: result.error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message
        }))
      });
    }
    req.validatedQuery = result.data;
    next();
  };
}

export function validateParams(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      return res.status(400).json({
        error: 'Invalid URL parameters',
        details: result.error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message
        }))
      });
    }
    req.validatedParams = result.data;
    next();
  };
}

export default {
  validateBody,
  validateQuery,
  validateParams
};
