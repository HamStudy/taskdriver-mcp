export * from './fileUtils.js';
export * from './validation.js';

/**
 * Generate a random API key
 */
export function generateApiKey(length: number = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Hash an API key for storage (simple hash for demo - use proper crypto in production)
 */
export function hashApiKey(apiKey: string): string {
  // In production, use a proper cryptographic hash like bcrypt
  // For demo purposes, we'll use a simple approach
  let hash = 0;
  for (let i = 0; i < apiKey.length; i++) {
    const char = apiKey.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Generate a correlation ID for request tracking
 */
export function generateCorrelationId(): string {
  return Math.random().toString(36).substr(2, 9);
}

/**
 * Replace template variables in a string
 */
export function replaceTemplateVariables(template: string, variables: Record<string, string>): string {
  let result = template;
  
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{{${key}}}`;
    result = result.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
  }
  
  return result;
}

/**
 * Extract template variables from a template string
 */
export function extractTemplateVariables(template: string): string[] {
  const matches = template.match(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g) || [];
  return matches.map(match => match.slice(2, -2)).filter((value, index, self) => self.indexOf(value) === index);
}

/**
 * Validate that all required template variables are provided
 */
export function validateTemplateVariables(template: string, variables: Record<string, string>): { valid: boolean; missing: string[] } {
  const required = extractTemplateVariables(template);
  const provided = Object.keys(variables);
  const missing = required.filter(variable => !provided.includes(variable));
  
  return {
    valid: missing.length === 0,
    missing,
  };
}

/**
 * Deep clone an object
 */
export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  if (obj instanceof Date) {
    return new Date(obj.getTime()) as any;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => deepClone(item)) as any;
  }
  
  const cloned = {} as any;
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }
  
  return cloned;
}