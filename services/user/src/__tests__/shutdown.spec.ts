import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupGracefulShutdown } from '../lib/shutdown.js';

const mocks = vi.hoisted(() => ({
  closeRedis: vi.fn(),
}));

vi.mock('../lib/redis.js', () => ({ closeRedis: mocks.closeRedis }));

describe('setupGracefulShutdown', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
    vi.useRealTimers();
  });

  it('closes the server, disconnects redis, and exits cleanly on SIGTERM', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const close = vi.fn((callback: () => void) => callback());
    setupGracefulShutdown({ close } as never);

    process.emit('SIGTERM');

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(close).toHaveBeenCalledOnce();
    expect(mocks.closeRedis).toHaveBeenCalledOnce();
    expect(consoleLog).toHaveBeenCalledWith('SIGTERM received, shutting down');
  });

  it('forces exit when the server does not close in time', async () => {
    vi.useFakeTimers();
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const close = vi.fn();
    setupGracefulShutdown({ close } as never);

    process.emit('SIGINT');
    await vi.advanceTimersByTimeAsync(10_000);

    expect(exit).toHaveBeenCalledWith(1);
    expect(close).toHaveBeenCalledOnce();
    expect(mocks.closeRedis).not.toHaveBeenCalled();
  });

  it('does not close the server on unrelated signals', () => {
    const close = vi.fn();
    setupGracefulShutdown({ close } as never);

    process.emit('SIGUSR1');

    expect(close).not.toHaveBeenCalled();
  });
});