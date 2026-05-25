import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSessionsSearchOutput } from '../lib/http/routes/cli.mjs';

test('parseSessionsSearchOutput handles local matches with scores', () => {
  const stdout = [
    '019e52e3-a43c-72b3-9dc4-67b14c18dedc (score: 6.94)  May 22, 11:32pm',
    '  Concurrency Fix Smoke Test Tab A',
    '  Concurrency fix smoke tab A. Run a terminal command that waits 5 seconds…',
    '019e52e0-ab48-70d1-86fc-52cbcfd781f7 (score: 6.94)  May 22, 11:28pm',
    '  Concurrency Fix Smoke Test Tab A',
    '  Concurrency fix smoke tab A. Run a terminal command that waits 5 seconds…',
    'Total: 2',
  ].join('\n');

  const results = parseSessionsSearchOutput(stdout);
  assert.equal(results.length, 2);
  assert.equal(results[0].id, '019e52e3-a43c-72b3-9dc4-67b14c18dedc');
  assert.equal(results[0].score, 6.94);
  assert.equal(results[0].remote, false);
  assert.equal(results[0].date, 'May 22, 11:32pm');
  assert.equal(results[0].title, 'Concurrency Fix Smoke Test Tab A');
  assert.match(results[0].snippet, /Concurrency fix smoke tab A/);
});

test('parseSessionsSearchOutput recognises remote sessions and missing score', () => {
  const stdout = [
    '019e5c3e-af46-7411-863c-ce72ad77b765 (remote)  May 24,  7:25pm',
    '  Ashley St. Clair Contradictions: Transcripts vs Legal vs Social Media',
    '  ### Role & Objective',
  ].join('\n');

  const [r] = parseSessionsSearchOutput(stdout);
  assert.ok(r);
  assert.equal(r.id, '019e5c3e-af46-7411-863c-ce72ad77b765');
  assert.equal(r.score, null);
  assert.equal(r.remote, true);
  assert.match(r.date, /May 24/);
  assert.match(r.title, /Ashley St. Clair/);
});

test('parseSessionsSearchOutput returns [] for empty, garbage, or non-string input', () => {
  assert.deepEqual(parseSessionsSearchOutput(''), []);
  assert.deepEqual(parseSessionsSearchOutput(null), []);
  assert.deepEqual(parseSessionsSearchOutput('No matches found.\nTotal: 0'), []);
});
