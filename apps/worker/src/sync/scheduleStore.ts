export interface SqlPool {
  query(sql: string, values?: any[]): Promise<any>;
}
