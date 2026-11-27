export type FreightCarrierBrand = 'qitexp' | 'skytuo' | 'desu' | 'depaex';

const PREFIXES: ReadonlyArray<readonly [string, FreightCarrierBrand]> = [
  ['QT', 'qitexp'],
  ['TT', 'skytuo'],
  ['DSL', 'desu'],
  ['YLD', 'depaex'],
  ['DP', 'depaex'],
];

export function normalizeFreightNumber(value: string): string {
  return value.trim().replace(/\s+/g, '').toUpperCase();
}

export function brandForInboundNumber(value: string): FreightCarrierBrand | undefined {
  const number = normalizeFreightNumber(value);
  return PREFIXES.find(([prefix]) => number.startsWith(prefix))?.[1];
}
