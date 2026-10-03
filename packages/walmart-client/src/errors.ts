export class WalmartHttpError extends Error { constructor(public status: number, message: string, public retryAfter?: number) { super(message); this.name = 'WalmartHttpError'; } }
