#!/usr/bin/env node

import assert from 'node:assert/strict';
import { withStableGeneratedBoundTextIds } from '../dist/core/bound-text.js';

const labelledShape = {
  id: 'box',
  type: 'rectangle',
  label: { text: 'hello' },
  boundElements: null,
};
const [normalized] = withStableGeneratedBoundTextIds([labelledShape]);
assert.deepEqual(normalized.label, { id: 'box-label', text: 'hello' });

const browserOwned = {
  ...labelledShape,
  boundElements: [{ type: 'text', id: 'browser-text' }],
};
assert.deepEqual(withStableGeneratedBoundTextIds([browserOwned]), [browserOwned]);

const explicitLabelId = {
  ...labelledShape,
  label: { id: 'custom-label', text: 'hello' },
};
assert.deepEqual(withStableGeneratedBoundTextIds([explicitLabelId]), [explicitLabelId]);

console.log('Bound-text ID check passed: generated labels receive stable identities.');
