/**
 * The committed golden manifest — the artifact the CAD side actually consumes.
 *
 * ── Why this lives in its own file ──────────────────────────────
 *
 * `verificationStore.demandRevision` is a monotonic counter for the life of the process, so the
 * revision a manifest carries depends on how many design runs preceded it. Vitest isolates test
 * FILES, so the chain below is the first in a fresh worker and the manifest it produces is the one
 * a user's FIRST export produces — `demand: 2`, not whatever a suite of earlier cases happened to
 * leave the counter at.
 *
 * That is not a technicality. A golden fixture that carried a revision no real first export ever
 * reaches would be a contract sample nobody could reproduce, and reproducing it is the entire
 * point: Decision 2A makes this file a shared fixture, so the consumer keeps a copy and any
 * divergence surfaces as a fixture diff rather than as a mysterious import failure.
 *
 * Regenerate with:
 *   WRITE_MANIFEST=1 npx vitest run src/lib/export/__tests__/rc-cad-handoff-golden.test.ts
 *
 * Review the diff before committing. A change here is a change to the contract.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildFootingCadHandoff } from '../../store/rc-cad-export';
import { validateRcCadHandoff } from '../rc-cad-handoff-validate';
import { rcCadHandoffFilename } from '../rc-cad-handoff';
import type { RcCadHandoffV1 } from '../rc-cad-handoff-types';
import { runProductionChain, fixtureText, keyTranslate } from './rc-cad-chain';

const GOLDEN = fileURLToPath(
  new URL('../__fixtures__/rc-footing-cad-poc.handoff.json', import.meta.url));

/** The numbers the PR record states. Asserted, so the record cannot drift from the file. */
const REPORTED = {
  byteLength: 88101,
  sha256: '795e9de26f2eb8ce8d51f2ac7130336702fc534588f390071e3bd40bc03aa0e7',
  fixtureSha256: '15ce4e150919bf8f91ef1e3fae36dcde584b770fea45861465742654153e3e79',
};

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('the golden RcCadHandoffV1 manifest', () => {
  it('the production chain reproduces the committed bytes exactly', async () => {
    await runProductionChain();
    const out = buildFootingCadHandoff(1, keyTranslate);
    expect(out.ok, 'the export must succeed').toBe(true);
    if (!out.ok) return;

    if (process.env.WRITE_MANIFEST) writeFileSync(GOLDEN, out.json, 'utf8');
    expect(existsSync(GOLDEN), 'the golden manifest must be committed').toBe(true);
    expect(out.json, 'produced manifest vs committed golden').toBe(readFileSync(GOLDEN, 'utf8'));

    // A first export in a clean process. If this number moves, the counter state moved with it,
    // and the golden would no longer be a sample anyone could reproduce.
    expect(out.handoff.revisions.demand).toBe(2);
    expect(out.filename).toBe('rc-cad-handoff-Z1-det3-dem2.json');
  }, 180_000);

  it('the committed golden is valid on both layers', () => {
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as RcCadHandoffV1;
    const v = validateRcCadHandoff(golden);
    expect(v.schema, 'schema violations').toEqual([]);
    expect(v.semantic, 'semantic violations').toEqual([]);
  });

  it('states its own identity, size and checksum', () => {
    const text = readFileSync(GOLDEN, 'utf8');
    const golden = JSON.parse(text) as RcCadHandoffV1;
    expect(golden.schema).toBe('RcCadHandoffV1');
    expect(golden.schemaVersion).toBe(1);
    expect(golden.generator).toEqual({ name: 'stabileo-rc-cad-handoff', version: '1.0.0' });
    expect(rcCadHandoffFilename(golden)).toBe('rc-cad-handoff-Z1-det3-dem2.json');
    expect(new TextEncoder().encode(text).length).toBe(REPORTED.byteLength);
    expect(sha256(text)).toBe(REPORTED.sha256);
    // And the source it was derived from, so the pair can be reconciled without guesswork.
    expect(sha256(fixtureText())).toBe(REPORTED.fixtureSha256);
  });
});
