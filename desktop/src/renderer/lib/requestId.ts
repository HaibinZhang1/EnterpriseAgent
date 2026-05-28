let counter = 0;

export function createRequestId(prefix: string): string {
  counter += 1;
  return `renderer_${prefix}_${Date.now()}_${counter}`;
}
