/**
 * Non-destructive counterpart to import-card-copies.ts: adds newly-appeared unique_ids from
 * data/card_copies_master.csv to the existing card_instances pool, without touching anything
 * already there. Unlike the original importer, this never deletes or re-seeds -- every existing
 * card_instances/exchange_events/verified_trades/seen_supercards row is left completely alone.
 *
 * Written for the situation import-card-copies.ts's own doc comment warned about: real trading
 * activity has started, so wiping and re-seeding the whole pool (which would erase every
 * student's ownership/trade history) is no longer an option when the master sheet grows --
 * only rows for unique_ids that don't already exist get inserted.
 *
 * Safe to re-run: every unique_id already present (from a previous run of this script, or the
 * original destructive import) is skipped, so running this twice with the same sheet is a
 * no-op the second time.
 *
 * Run via `npx tsx scripts/add-card-copies.ts` (or against a scratch DB first, e.g.
 * `DB_PATH=/tmp/x.db npx tsx scripts/add-card-copies.ts`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { db, insertCardInstanceForImport, findCardInstanceByUniqueId } from '../server/db';
import { getSupercardByHighlightId } from '../src/data/supercards';

const here = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.resolve(here, '../data/card_copies_master.csv');

interface CopyRow {
    card_super_id: string;
    card_title: string;
    copy_number: string;
    unique_id: string;
    url: string;
}

const csvText = fs.readFileSync(CSV_PATH, 'utf-8');
const rows: CopyRow[] = parse(csvText, { columns: true, skip_empty_lines: true });

// Same up-front, fail-loudly-before-touching-anything resolution as import-card-copies.ts --
// a typo'd/unknown card_super_id should abort the whole run, not silently skip that row.
const unresolved = new Set<string>();
const resolved = rows.map((row) => {
    const supercard = getSupercardByHighlightId(row.card_super_id);
    if (!supercard) unresolved.add(row.card_super_id);
    return { row, supercardN: supercard?.n };
});
if (unresolved.size > 0) {
    throw new Error(
        `card_copies_master.csv references card_super_id(s) not found in the master content ` +
            `sheet: ${[...unresolved].join(', ')}. Check both sheets are in sync before importing.`,
    );
}

// De-dupe by unique_id within the sheet itself -- a re-exported master sheet has been seen to
// contain the exact same row twice (a spreadsheet export glitch, not a real second copy with
// the same code), so the first occurrence wins and every later exact repeat is just skipped
// rather than tripping the UNIQUE index or the "already exists" logic below.
const seenInSheet = new Set<string>();
const deduped: typeof resolved = [];
let duplicateRowsInSheet = 0;
for (const entry of resolved) {
    if (seenInSheet.has(entry.row.unique_id)) {
        duplicateRowsInSheet++;
        continue;
    }
    seenInSheet.add(entry.row.unique_id);
    deduped.push(entry);
}

console.log(
    `Parsed ${rows.length} rows (${duplicateRowsInSheet} exact duplicate rows skipped) across ` +
        `${new Set(rows.map((r) => r.card_super_id)).size} designs.`,
);

// Split into "already exists" (untouched) vs. "new" (to insert) before opening a transaction,
// so the console summary is accurate even if something below throws partway through.
const toInsert = deduped.filter(({ row }) => !findCardInstanceByUniqueId(row.unique_id));
const alreadyExisted = deduped.length - toInsert.length;

console.log(`${alreadyExisted} unique_ids already exist in card_instances -- left untouched.`);
console.log(`${toInsert.length} new unique_ids to add.`);

if (toInsert.length === 0) {
    console.log('Nothing to do.');
} else {
    db.exec('BEGIN');
    try {
        for (const { row, supercardN } of toInsert) {
            insertCardInstanceForImport(supercardN!, row.unique_id, parseInt(row.copy_number, 10));
        }
        db.exec('COMMIT');
    } catch (err) {
        db.exec('ROLLBACK');
        throw err;
    }
    console.log(`Added ${toInsert.length} new card instances. Nothing existing was modified.`);
}
