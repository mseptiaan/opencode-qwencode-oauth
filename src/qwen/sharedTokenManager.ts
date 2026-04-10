/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { promises as fs, unlinkSync } from 'node:fs';
import * as os from 'os';
import { randomUUID } from 'node:crypto';
import { createLogger } from '../plugin/logger.js';

const debugLogger = createLogger('SharedTokenManager');

export interface QwenCredentials {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expiry_date?: number;
  resource_url?: string;
}

export interface TokenRefreshData {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  resource_url?: string;
}

export interface ErrorData {
  error: string;
  error_description?: string;
}

export function isErrorResponse(response: unknown): response is ErrorData {
  return typeof response === 'object' && response !== null && 'error' in response;
}

export class CredentialsClearRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialsClearRequiredError';
  }
}

export interface QwenTokenClient {
  getCredentials(): QwenCredentials;
  setCredentials(credentials: QwenCredentials): void;
  refreshAccessToken(): Promise<TokenRefreshData | ErrorData>;
}

// File System Configuration
const QWEN_DIR = '.qwen';
const QWEN_CREDENTIAL_FILENAME = 'oauth_creds.json';
const QWEN_LOCK_FILENAME = 'oauth_creds.lock';

// Token and Cache Configuration
const TOKEN_REFRESH_BUFFER_MS = 30 * 1000; // 30 seconds
const LOCK_TIMEOUT_MS = 10000; // 10 seconds lock timeout
const CACHE_CHECK_INTERVAL_MS = 5000; // 5 seconds cache check interval

interface LockConfig {
  maxAttempts: number;
  attemptInterval: number;
  maxInterval: number;
}

const DEFAULT_LOCK_CONFIG: LockConfig = {
  maxAttempts: 20,
  attemptInterval: 100,
  maxInterval: 2000,
};

export enum TokenError {
  REFRESH_FAILED = 'REFRESH_FAILED',
  NO_REFRESH_TOKEN = 'NO_REFRESH_TOKEN',
  LOCK_TIMEOUT = 'LOCK_TIMEOUT',
  FILE_ACCESS_ERROR = 'FILE_ACCESS_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
}

export class TokenManagerError extends Error {
  constructor(
    public type: TokenError,
    message: string,
    public originalError?: unknown,
  ) {
    super(message);
    this.name = 'TokenManagerError';
  }
}

interface MemoryCache {
  credentials: QwenCredentials | null;
  fileModTime: number;
  lastCheck: number;
}

function validateCredentials(data: unknown): QwenCredentials {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid credentials format');
  }

  const creds = data as Partial<QwenCredentials>;
  const requiredFields = ['access_token', 'refresh_token', 'token_type'] as const;

  for (const field of requiredFields) {
    if (!creds[field] || typeof creds[field] !== 'string') {
      throw new Error(`Invalid credentials: missing ${field}`);
    }
  }

  if (!creds.expiry_date || typeof creds.expiry_date !== 'number') {
    throw new Error('Invalid credentials: missing expiry_date');
  }

  return creds as QwenCredentials;
}

export class SharedTokenManager {
  private static instance: SharedTokenManager | null = null;

  private memoryCache: MemoryCache = {
    credentials: null,
    fileModTime: 0,
    lastCheck: 0,
  };

  private refreshPromise: Promise<QwenCredentials> | null = null;
  private checkPromise: Promise<void> | null = null;
  private cleanupHandlersRegistered = false;
  private cleanupFunction: (() => void) | null = null;
  private lockConfig: LockConfig = DEFAULT_LOCK_CONFIG;

  private constructor() {
    this.registerCleanupHandlers();
  }

  static getInstance(): SharedTokenManager {
    if (!SharedTokenManager.instance) {
      SharedTokenManager.instance = new SharedTokenManager();
    }
    return SharedTokenManager.instance;
  }

  private registerCleanupHandlers(): void {
    if (this.cleanupHandlersRegistered) {
      return;
    }

    this.cleanupFunction = () => {
      try {
        const lockPath = this.getLockFilePath();
        unlinkSync(lockPath);
      } catch (_error) {
      }
    };

    process.on('exit', this.cleanupFunction);
    process.on('SIGINT', this.cleanupFunction);
    process.on('SIGTERM', this.cleanupFunction);
    process.on('uncaughtException', this.cleanupFunction);
    process.on('unhandledRejection', this.cleanupFunction);

    this.cleanupHandlersRegistered = true;
  }

  async getValidCredentials(
    qwenClient: QwenTokenClient,
    forceRefresh = false,
  ): Promise<QwenCredentials> {
    try {
      await this.checkAndReloadIfNeeded(qwenClient);

      if (
        !forceRefresh &&
        this.memoryCache.credentials &&
        this.isTokenValid(this.memoryCache.credentials)
      ) {
        return this.memoryCache.credentials;
      }

      let currentRefreshPromise = this.refreshPromise;

      if (!currentRefreshPromise) {
        currentRefreshPromise = this.performTokenRefresh(
          qwenClient,
          forceRefresh,
        );
        this.refreshPromise = currentRefreshPromise;
      }

      try {
        const result = await currentRefreshPromise;
        return result;
      } finally {
        if (this.refreshPromise === currentRefreshPromise) {
          this.refreshPromise = null;
        }
      }
    } catch (error) {
      if (error instanceof TokenManagerError) {
        throw error;
      }

      throw new TokenManagerError(
        TokenError.REFRESH_FAILED,
        `Failed to get valid credentials: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }

  private async checkAndReloadIfNeeded(
    qwenClient?: QwenTokenClient,
  ): Promise<void> {
    if (this.checkPromise) {
      await this.checkPromise;
      return;
    }

    if (this.refreshPromise) {
      return;
    }

    const now = Date.now();

    if (now - this.memoryCache.lastCheck < CACHE_CHECK_INTERVAL_MS) {
      return;
    }

    this.checkPromise = this.performFileCheck(qwenClient, now);

    try {
      await this.checkPromise;
    } finally {
      this.checkPromise = null;
    }
  }

  private withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    operationType = 'Operation',
  ): Promise<T> {
    let timeoutId: NodeJS.Timeout;

    return Promise.race([
      promise.finally(() => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () =>
            reject(
              new Error(`${operationType} timed out after ${timeoutMs}ms`),
            ),
          timeoutMs,
        );
      }),
    ]);
  }

  private async performFileCheck(
    qwenClient: QwenTokenClient | undefined,
    checkTime: number,
  ): Promise<void> {
    this.memoryCache.lastCheck = checkTime;

    try {
      const filePath = this.getCredentialFilePath();

      const stats = await this.withTimeout(
        fs.stat(filePath),
        3000,
        'File operation',
      );
      const fileModTime = stats.mtimeMs;

      if (fileModTime > this.memoryCache.fileModTime) {
        await this.reloadCredentialsFromFile(qwenClient);
        this.memoryCache.fileModTime = fileModTime;
      }
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code !== 'ENOENT'
      ) {
        this.updateCacheState(null, 0, checkTime);

        throw new TokenManagerError(
          TokenError.FILE_ACCESS_ERROR,
          `Failed to access credentials file: ${error.message}`,
          error,
        );
      }

      this.memoryCache.fileModTime = 0;
    }
  }

  private async forceFileCheck(qwenClient?: QwenTokenClient): Promise<void> {
    try {
      const filePath = this.getCredentialFilePath();
      const stats = await fs.stat(filePath);
      const fileModTime = stats.mtimeMs;

      if (fileModTime > this.memoryCache.fileModTime) {
        await this.reloadCredentialsFromFile(qwenClient);
        this.memoryCache.fileModTime = fileModTime;
        this.memoryCache.lastCheck = Date.now();
      }
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code !== 'ENOENT'
      ) {
        this.updateCacheState(null, 0);

        throw new TokenManagerError(
          TokenError.FILE_ACCESS_ERROR,
          `Failed to access credentials file during refresh: ${error.message}`,
          error,
        );
      }

      this.memoryCache.fileModTime = 0;
    }
  }

  private async reloadCredentialsFromFile(
    qwenClient?: QwenTokenClient,
  ): Promise<void> {
    try {
      const filePath = this.getCredentialFilePath();
      const content = await fs.readFile(filePath, 'utf-8');
      const parsedData = JSON.parse(content);
      const credentials = validateCredentials(parsedData);

      const previousCredentials = this.memoryCache.credentials;

      this.memoryCache.credentials = credentials;

      try {
        if (qwenClient) {
          qwenClient.setCredentials(credentials);
        }
      } catch (clientError) {
        this.memoryCache.credentials = previousCredentials;
        throw clientError;
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('Invalid credentials')
      ) {
        debugLogger.warn(
          `Failed to validate credentials file: ${error.message}`,
        );
      }
      this.memoryCache.credentials = null;
    }
  }

  private async performTokenRefresh(
    qwenClient: QwenTokenClient,
    forceRefresh = false,
  ): Promise<QwenCredentials> {
    const startTime = Date.now();
    const lockPath = this.getLockFilePath();
    let lockAcquired = false;

    try {
      const currentCredentials = qwenClient.getCredentials();
      if (!currentCredentials.refresh_token) {
        throw new TokenManagerError(
          TokenError.NO_REFRESH_TOKEN,
          'No refresh token available for token refresh',
        );
      }

      await this.acquireLock(lockPath);
      lockAcquired = true;

      const lockAcquisitionTime = Date.now() - startTime;
      if (lockAcquisitionTime > 5000) {
        debugLogger.warn(
          `Token refresh lock acquisition took ${lockAcquisitionTime}ms`,
        );
      }

      await this.forceFileCheck(qwenClient);

      if (
        !forceRefresh &&
        this.memoryCache.credentials &&
        this.isTokenValid(this.memoryCache.credentials)
      ) {
        return this.memoryCache.credentials;
      }

      const response = await qwenClient.refreshAccessToken();

      const totalOperationTime = Date.now() - startTime;
      if (totalOperationTime > 10000) {
        debugLogger.warn(
          `Token refresh operation took ${totalOperationTime}ms`,
        );
      }

      if (!response || isErrorResponse(response)) {
        const errorData = response as ErrorData;
        throw new TokenManagerError(
          TokenError.REFRESH_FAILED,
          `Token refresh failed: ${errorData?.error || 'Unknown error'} - ${errorData?.error_description || 'No details provided'}`,
        );
      }

      const tokenData = response as TokenRefreshData;

      if (!tokenData.access_token) {
        throw new TokenManagerError(
          TokenError.REFRESH_FAILED,
          'Failed to refresh access token: no token returned',
        );
      }

      const credentials: QwenCredentials = {
        access_token: tokenData.access_token,
        token_type: tokenData.token_type,
        refresh_token:
          tokenData.refresh_token || currentCredentials.refresh_token,
        resource_url: tokenData.resource_url,
        expiry_date: Date.now() + tokenData.expires_in * 1000,
      };

      this.memoryCache.credentials = credentials;
      qwenClient.setCredentials(credentials);

      await this.saveCredentialsToFile(credentials);

      return credentials;
    } catch (error) {
      if (error instanceof CredentialsClearRequiredError) {
        debugLogger.debug(
          'SharedTokenManager: Clearing memory cache due to credentials clear requirement',
        );
        this.memoryCache.credentials = null;
        this.memoryCache.fileModTime = 0;
        this.refreshPromise = null;

        throw new TokenManagerError(
          TokenError.REFRESH_FAILED,
          error.message,
          error,
        );
      }

      if (error instanceof TokenManagerError) {
        throw error;
      }

      if (
        error instanceof Error &&
        (error.message.includes('fetch') ||
          error.message.includes('network') ||
          error.message.includes('timeout'))
      ) {
        throw new TokenManagerError(
          TokenError.NETWORK_ERROR,
          `Network error during token refresh: ${error.message}`,
          error,
        );
      }

      throw new TokenManagerError(
        TokenError.REFRESH_FAILED,
        `Unexpected error during token refresh: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    } finally {
      if (lockAcquired) {
        await this.releaseLock(lockPath);
      }
    }
  }

  private async saveCredentialsToFile(
    credentials: QwenCredentials,
  ): Promise<void> {
    const filePath = this.getCredentialFilePath();
    const dirPath = path.dirname(filePath);
    const tempPath = `${filePath}.tmp.${randomUUID()}`;

    try {
      await this.withTimeout(
        fs.mkdir(dirPath, { recursive: true, mode: 0o700 }),
        5000,
        'File operation',
      );
    } catch (error) {
      throw new TokenManagerError(
        TokenError.FILE_ACCESS_ERROR,
        `Failed to create credentials directory: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }

    const credString = JSON.stringify(credentials, null, 2);

    try {
      await this.withTimeout(
        fs.writeFile(tempPath, credString, { mode: 0o600 }),
        5000,
        'File operation',
      );

      await this.withTimeout(
        fs.rename(tempPath, filePath),
        5000,
        'File operation',
      );

      const stats = await this.withTimeout(
        fs.stat(filePath),
        5000,
        'File operation',
      );
      this.memoryCache.fileModTime = stats.mtimeMs;
    } catch (error) {
      try {
        await this.withTimeout(fs.unlink(tempPath), 1000, 'File operation');
      } catch (_cleanupError) {
      }

      throw new TokenManagerError(
        TokenError.FILE_ACCESS_ERROR,
        `Failed to write credentials file: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }

  private isTokenValid(credentials: QwenCredentials): boolean {
    if (!credentials.expiry_date || !credentials.access_token) {
      return false;
    }
    return Date.now() < credentials.expiry_date - TOKEN_REFRESH_BUFFER_MS;
  }

  private getCredentialFilePath(): string {
    return path.join(os.homedir(), QWEN_DIR, QWEN_CREDENTIAL_FILENAME);
  }

  private getLockFilePath(): string {
    return path.join(os.homedir(), QWEN_DIR, QWEN_LOCK_FILENAME);
  }

  private async acquireLock(lockPath: string): Promise<void> {
    const { maxAttempts, attemptInterval, maxInterval } = this.lockConfig;
    const lockId = randomUUID();

    let currentInterval = attemptInterval;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await fs.mkdir(path.dirname(lockPath), { recursive: true }).catch(() => {});
        await fs.writeFile(lockPath, lockId, { flag: 'wx' });
        return;
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          try {
            const stats = await fs.stat(lockPath);
            const lockAge = Date.now() - stats.mtimeMs;

            if (lockAge > LOCK_TIMEOUT_MS) {
              const tempPath = `${lockPath}.stale.${randomUUID()}`;
              try {
                await fs.rename(lockPath, tempPath);
                await fs.unlink(tempPath);
                debugLogger.warn(
                  `Removed stale lock file: ${lockPath} (age: ${lockAge}ms)`,
                );
                continue;
              } catch (renameError) {
                debugLogger.warn(
                  `Failed to remove stale lock file ${lockPath}: ${renameError instanceof Error ? renameError.message : String(renameError)}`,
                );
              }
            }
          } catch (statError) {
            debugLogger.warn(
              `Failed to stat lock file ${lockPath}: ${statError instanceof Error ? statError.message : String(statError)}`,
            );
          }

          await new Promise((resolve) => setTimeout(resolve, currentInterval));
          currentInterval = Math.min(currentInterval * 1.5, maxInterval);
        } else {
          throw new TokenManagerError(
            TokenError.FILE_ACCESS_ERROR,
            `Failed to create lock file: ${error instanceof Error ? error.message : String(error)}`,
            error,
          );
        }
      }
    }

    throw new TokenManagerError(
      TokenError.LOCK_TIMEOUT,
      'Failed to acquire file lock for token refresh: timeout exceeded',
    );
  }

  private async releaseLock(lockPath: string): Promise<void> {
    try {
      await fs.unlink(lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        debugLogger.warn(
          `Failed to release lock file ${lockPath}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private updateCacheState(
    credentials: QwenCredentials | null,
    fileModTime: number,
    lastCheck?: number,
  ): void {
    this.memoryCache = {
      credentials,
      fileModTime,
      lastCheck: lastCheck ?? Date.now(),
    };
  }

  clearCache(): void {
    this.updateCacheState(null, 0, 0);
    this.refreshPromise = null;
    this.checkPromise = null;
  }

  getCurrentCredentials(): QwenCredentials | null {
    return this.memoryCache.credentials;
  }

  isRefreshInProgress(): boolean {
    return this.refreshPromise !== null;
  }

  setLockConfig(config: Partial<LockConfig>): void {
    this.lockConfig = { ...DEFAULT_LOCK_CONFIG, ...config };
  }

  cleanup(): void {
    if (this.cleanupFunction && this.cleanupHandlersRegistered) {
      this.cleanupFunction();

      process.removeListener('exit', this.cleanupFunction);
      process.removeListener('SIGINT', this.cleanupFunction);
      process.removeListener('SIGTERM', this.cleanupFunction);
      process.removeListener('uncaughtException', this.cleanupFunction);
      process.removeListener('unhandledRejection', this.cleanupFunction);

      this.cleanupHandlersRegistered = false;
      this.cleanupFunction = null;
    }
  }

  getDebugInfo(): {
    hasCredentials: boolean;
    credentialsExpired: boolean;
    isRefreshing: boolean;
    cacheAge: number;
  } {
    const hasCredentials = !!this.memoryCache.credentials;
    const credentialsExpired = hasCredentials
      ? !this.isTokenValid(this.memoryCache.credentials!)
      : false;

    return {
      hasCredentials,
      credentialsExpired,
      isRefreshing: this.isRefreshInProgress(),
      cacheAge: Date.now() - this.memoryCache.lastCheck,
    };
  }
}
