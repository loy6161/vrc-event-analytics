/**
 * Centralized HTTP response helpers for Express routes.
 *
 * All API responses follow this envelope format:
 *   Success: { success: true,  data: T,       timestamp: string }
 *   Failure: { success: false, error: string, timestamp: string }
 *
 * Use ok() / fail() in every route handler instead of res.json() directly.
 */

import { Response } from 'express'

// ─── Types ────────────────────────────────────────────────────────

export interface ApiSuccess<T> {
  success: true
  data: T
  timestamp: string
}

export interface ApiFailure {
  success: false
  error: string
  timestamp: string
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure

// ─── Helpers ──────────────────────────────────────────────────────

/** Send a successful JSON response (default 200) */
export function ok<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({
    success: true,
    data,
    timestamp: new Date().toISOString(),
  } satisfies ApiSuccess<T>)
}

/** Send a failure JSON response (default 500) */
export function fail(res: Response, message: string, status = 500): void {
  res.status(status).json({
    success: false,
    error: message,
    timestamp: new Date().toISOString(),
  } satisfies ApiFailure)
}

/** Parse an Express route parameter to integer; returns null if invalid */
export function parseId(param: string): number | null {
  const id = parseInt(param, 10)
  return isNaN(id) ? null : id
}

/** Coerce unknown catch values to a readable message string */
export function toMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
