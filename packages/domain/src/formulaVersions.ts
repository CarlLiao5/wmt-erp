export const formulaVersions = { v1: { id: 'v1', label: '基础经营指标公式' } } as const;
export type FormulaVersion = keyof typeof formulaVersions;
