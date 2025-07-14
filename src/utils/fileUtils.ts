import { promises as fs } from 'fs';
import { constants } from 'fs';
import path from 'path';

/**
 * File utilities for atomic operations and safe file handling
 */

/**
 * Ensure a directory exists, creating it if necessary
 */
export async function ensureDirectory(dirPath: string): Promise<void> {
  try {
    await fs.access(dirPath, constants.F_OK);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

/**
 * Write data to a file atomically using temp file + rename
 */
export async function writeFileAtomic(filePath: string, data: string): Promise<void> {
  const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    // Ensure directory exists
    await ensureDirectory(path.dirname(filePath));
    
    // Write to temp file
    await fs.writeFile(tempPath, data, 'utf8');
    
    // Atomic rename
    await fs.rename(tempPath, filePath);
  } catch (error) {
    // Clean up temp file if it exists
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

/**
 * Read a file safely, returning null if it doesn't exist
 */
export async function readFileSafe(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Check if a file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get file stats safely, returning null if file doesn't exist
 */
export async function getFileStats(filePath: string): Promise<{ size: number; mtime: Date } | null> {
  try {
    const stats = await fs.stat(filePath);
    return {
      size: stats.size,
      mtime: stats.mtime,
    };
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * List all files in a directory with a specific extension
 */
export async function listFiles(dirPath: string, extension: string): Promise<string[]> {
  try {
    const files = await fs.readdir(dirPath);
    return files
      .filter(file => file.endsWith(extension))
      .map(file => path.join(dirPath, file));
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * Remove a file safely (no error if it doesn't exist)
 */
export async function removeFileSafe(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}