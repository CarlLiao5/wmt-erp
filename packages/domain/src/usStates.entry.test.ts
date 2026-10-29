import { describe, expect, it } from 'vitest';
import { US_STATES_48 } from '../index.js';

describe('domain package entrypoint', () => {
  it('exports the 48-state configuration', () => {
    expect(US_STATES_48).toHaveLength(48);
  });
});
