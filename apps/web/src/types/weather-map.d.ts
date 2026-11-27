declare module 'topojson-client' {
  export function feature(topology: unknown, object: unknown): unknown;
}

declare module 'us-atlas/states-albers-10m.json' {
  const topology: unknown;
  export default topology;
}
