export interface WalmartConnection { clientId: string; clientSecret: string; environment: 'sandbox' | 'production'; baseUrl: string; accessToken?: string; accessTokenExpiresAt?: number; }
export interface TokenResult { accessToken: string; tokenType: string; expiresIn: number; }
export interface WalmartResponse<T> { data: T; status: number; correlationId: string; headers: Headers; }
