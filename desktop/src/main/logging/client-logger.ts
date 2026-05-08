import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { redactForLog, redactString } from '../../shared/redaction';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  requestID?: string;
  fields?: unknown;
}

export class ClientLogger {
  constructor(private readonly logFile: string) {}

  async info(message: string, fields?: unknown, requestID?: string): Promise<void> {
    await this.write('info', message, fields, requestID);
  }

  async warn(message: string, fields?: unknown, requestID?: string): Promise<void> {
    await this.write('warn', message, fields, requestID);
  }

  async error(message: string, fields?: unknown, requestID?: string): Promise<void> {
    await this.write('error', message, fields, requestID);
  }

  async recent(limit = 50): Promise<LogEntry[]> {
    try {
      const text = await readFile(this.logFile, 'utf8');
      return text.trim().split('\n').filter(Boolean).slice(-limit).map((line) => JSON.parse(line) as LogEntry);
    } catch {
      return [];
    }
  }

  private async write(level: LogLevel, message: string, fields?: unknown, requestID?: string): Promise<void> {
    await mkdir(path.dirname(this.logFile), { recursive: true });
    const existing = await this.readRaw();
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message: redactString(message),
      requestID,
      fields: fields === undefined ? undefined : redactForLog(fields)
    };
    await writeFile(this.logFile, `${existing}${JSON.stringify(entry)}\n`, 'utf8');
  }

  private async readRaw(): Promise<string> {
    try {
      return await readFile(this.logFile, 'utf8');
    } catch {
      return '';
    }
  }
}
