/**
 * Utilities for command processing
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Project, TaskType } from '../types';

/**
 * Reads content from a file path if the value starts with '@', otherwise returns the value as-is
 */
export function readContentFromFileOrValue(value: string): string {
  if (value.startsWith('@')) {
    const filePath = value.slice(1); // Remove the '@' prefix
    try {
      const absolutePath = resolve(filePath);
      return readFileSync(absolutePath, 'utf-8').trim();
    } catch (error: any) {
      throw new Error(`Failed to read file '${filePath}': ${error?.message ?? error}`);
    }
  }
  return value;
}

/**
 * Find project by name or ID from a list of projects
 */
export function findProjectByNameOrId<P extends Pick<Project, 'name' | 'id'>>(projects: P[], nameOrId: string) {
  return projects.find(p => p.name === nameOrId || p.id === nameOrId);
}

/**
 * Find task type by name or ID from a list of task types
 */
export function findTaskTypeByNameOrId<T extends Pick<TaskType, 'name' | 'id'>>(taskTypes: T[], nameOrId: string) {
  return taskTypes.find(tt => tt.name === nameOrId || tt.id === nameOrId);
}

/**
 * Parse JSON safely with error handling
 */
export function parseJsonSafely(jsonStr: string, context: string = 'JSON') {
  try {
    return JSON.parse(jsonStr);
  } catch (error: any) {
    throw new Error(`Invalid ${context}: ${error.message}`);
  }
}