export interface Money { amount: string; currency: string; }
export function money(amount: string | number, currency: string): Money { if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Invalid currency'); return { amount: String(amount), currency }; }
