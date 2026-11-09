import assert from 'node:assert/strict';
import test from 'node:test';
import { createDlnaPositionFilter, readDlnaTime } from '../services/dlnaPosition.ts';

test('reads DLNA times and rejects unusable values', () => {
  assert.equal(readDlnaTime('01:02:03'), 3723);
  assert.equal(readDlnaTime('0:00:05.500'), 5.5);
  assert.equal(readDlnaTime('00:00:00'), 0);
  for (const value of [undefined, '', 'NOT_IMPLEMENTED', '12:34', 'abc', '-1:00:00']) {
    assert.equal(readDlnaTime(value), undefined, String(value));
  }
});

test('keeps the last position when the TV gives none or a transient zero', () => {
  const filter = createDlnaPositionFilter();
  assert.equal(filter.accept(600, 'PLAYING'), 600);
  assert.equal(filter.accept(undefined, 'PLAYING'), undefined);
  assert.equal(filter.accept(0, 'TRANSITIONING'), undefined);
  assert.equal(filter.accept(0, 'PLAYING'), undefined, 'A single zero is a glitch');
  assert.equal(filter.accept(602, 'PLAYING'), 602);
});

test('accepts a confirmed return to the start and user seeks to zero', () => {
  const filter = createDlnaPositionFilter();
  filter.accept(600, 'PLAYING');
  assert.equal(filter.accept(0, 'PLAYING'), undefined);
  assert.equal(filter.accept(0, 'PLAYING'), 0, 'Two zeros in a row are real');
  filter.accept(300, 'PLAYING');
  filter.set(0);
  assert.equal(filter.accept(0, 'PLAYING'), 0);
  assert.equal(createDlnaPositionFilter().accept(0, 'PLAYING'), 0, 'Start of playback');
});
