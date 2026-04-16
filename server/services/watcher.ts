// File watching is not supported in cloud/serverless deployments.
// This module is kept as a stub so imports don't break during compilation.
// The watcher route returns a cloud-mode response; this service is not called.

export type WatcherEventType =
  | 'watcher:started'
  | 'watcher:stopped'
  | 'watcher:file_detected'
  | 'watcher:file_imported'
  | 'watcher:file_skipped'
  | 'watcher:error'
  | 'watcher:heartbeat'

export interface WatcherEvent {
  type: WatcherEventType
  timestamp: string
  data?: Record<string, unknown>
}

export interface WatcherStatus {
  watching: boolean
  directory: string | null
  cloudMode: true
}

export function getWatcherStatus(): WatcherStatus {
  return { watching: false, directory: null, cloudMode: true }
}

export function startWatcher(_directory: string): void {
  throw new Error('File watching is not supported in cloud mode.')
}

export function stopWatcher(): void {
  // no-op
}

export function addSseClient(_res: unknown): void {
  // no-op
}

export function removeSseClient(_res: unknown): void {
  // no-op
}
