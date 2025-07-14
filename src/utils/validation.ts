import Joi from 'joi';

/**
 * Common validation schemas for TaskDriver
 */

export const projectNameSchema = Joi.string()
  .min(1)
  .max(100)
  .pattern(/^[a-zA-Z0-9_-]+$/)
  .required()
  .messages({
    'string.pattern.base': 'Project name can only contain letters, numbers, hyphens, and underscores',
  });

export const agentNameSchema = Joi.string()
  .min(1)
  .max(50)
  .pattern(/^[a-zA-Z0-9_-]+$/)
  .messages({
    'string.pattern.base': 'Agent name can only contain letters, numbers, hyphens, and underscores',
  });

export const taskTypeNameSchema = Joi.string()
  .min(1)
  .max(100)
  .pattern(/^[a-zA-Z0-9_-]+$/)
  .required()
  .messages({
    'string.pattern.base': 'Task type name can only contain letters, numbers, hyphens, and underscores',
  });

export const uuidSchema = Joi.string()
  .uuid({ version: ['uuidv4'] })
  .required();

export const variablesSchema = Joi.object()
  .pattern(
    Joi.string().pattern(/^[a-zA-Z][a-zA-Z0-9_]*$/),
    Joi.string().max(1000)
  )
  .max(50)
  .messages({
    'object.pattern.match': 'Variable names must start with a letter and contain only letters, numbers, and underscores',
  });

export const instructionsSchema = Joi.string()
  .min(1)
  .max(10000)
  .required();

export const explanationSchema = Joi.string()
  .min(1)
  .max(2000)
  .required();

/**
 * Validation schemas for service inputs
 */

export const createProjectSchema = Joi.object({
  name: projectNameSchema,
  description: Joi.string().max(500).required(),
  config: Joi.object({
    defaultMaxRetries: Joi.number().integer().min(0).max(10),
    defaultLeaseDurationMinutes: Joi.number().integer().min(1).max(1440), // Max 24 hours
    reaperIntervalMinutes: Joi.number().integer().min(1).max(60),
  }).optional(),
});

export const createTaskTypeSchema = Joi.object({
  name: taskTypeNameSchema,
  projectId: uuidSchema,
  template: Joi.string().max(10000).optional(),
  variables: Joi.array().items(Joi.string().pattern(/^[a-zA-Z][a-zA-Z0-9_]*$/)).max(20).optional(),
  duplicateHandling: Joi.string().valid('ignore', 'fail', 'allow').default('allow'),
  maxRetries: Joi.number().integer().min(0).max(10).optional(),
  leaseDurationMinutes: Joi.number().integer().min(1).max(1440).optional(),
});

export const createTaskSchema = Joi.object({
  projectId: uuidSchema,
  typeId: uuidSchema,
  instructions: instructionsSchema,
  variables: variablesSchema.optional(),
  batchId: Joi.string().uuid().optional(),
});

export const createAgentSchema = Joi.object({
  name: agentNameSchema.optional(),
  projectId: uuidSchema,
  capabilities: Joi.array().items(Joi.string().max(100)).max(20).optional(),
});

export const taskFiltersSchema = Joi.object({
  projectId: uuidSchema,
  status: Joi.string().valid('queued', 'running', 'completed', 'failed').optional(),
  assignedTo: agentNameSchema.optional(),
  batchId: Joi.string().uuid().optional(),
  typeId: uuidSchema.optional(),
  limit: Joi.number().integer().min(1).max(1000).default(100),
  offset: Joi.number().integer().min(0).default(0),
});

/**
 * Validate data against a schema
 */
export function validate<T = any>(schema: Joi.Schema, data: unknown): T {
  const { error, value } = schema.validate(data, {
    abortEarly: false,
    stripUnknown: false,
    allowUnknown: false,
  });

  if (error) {
    const details = error.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message,
      value: detail.context?.value,
    }));
    
    const message = `Validation failed: ${details.map(d => `${d.field}: ${d.message}`).join(', ')}`;
    const validationError = new Error(message) as any;
    validationError.validationDetails = details;
    validationError.isValidationError = true;
    
    throw validationError;
  }

  return value;
}

/**
 * Check if an error is a validation error
 */
export function isValidationError(error: any): boolean {
  return error && error.isValidationError === true;
}