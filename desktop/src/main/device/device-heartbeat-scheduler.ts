export interface DeviceHeartbeatSchedulerOptions {
  intervalMs?: number;
  immediate?: boolean;
  onError?: (error: unknown) => void | Promise<void>;
  requestIDPrefix?: string;
}

export class DeviceHeartbeatScheduler {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly heartbeat: (requestID?: string) => Promise<unknown>,
    private readonly options: DeviceHeartbeatSchedulerOptions = {}
  ) {}

  start(): void {
    if (this.timer) return;
    if (this.options.immediate) {
      void this.tick('startup');
    }
    const intervalMs = this.options.intervalMs ?? 5 * 60 * 1_000;
    const timer = setInterval(() => {
      void this.tick('scheduled');
    }, intervalMs);
    if (typeof timer === 'object' && 'unref' in timer) {
      timer.unref();
    }
    this.timer = timer;
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(reason = 'manual'): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.heartbeat(this.requestID(reason));
    } catch (error) {
      await this.options.onError?.(error);
    } finally {
      this.running = false;
    }
  }

  private requestID(reason: string): string {
    const prefix = this.options.requestIDPrefix ?? 'device_heartbeat';
    return `${prefix}_${reason}_${Date.now()}`;
  }
}
