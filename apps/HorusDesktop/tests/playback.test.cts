import { test } from "node:test";
import assert from "node:assert/strict";
import { resumePosition } from "../src/services/playback";

test("resumes short clips and long media but restarts completed media", () => {
  assert.equal(resumePosition(1, 6), 1);
  assert.equal(resumePosition(120, 3600), 120);
  assert.equal(resumePosition(5.95, 6), 0);
  assert.equal(resumePosition(3598, 3600), 0);
  for (const position of [-1, Infinity, NaN, 7000])
    assert.equal(resumePosition(position, 3600), 0);
  assert.equal(resumePosition(10, Infinity), 0);
});
