/**
 * One-off script: wipes all existing card ownership/copies and re-seeds card_instances from
 * data/card_copies_master.csv, the pre-generated master list of every physical card copy that
 * will ever exist (one row per copy, with its own unique_id printed in that copy's QR code).
 *
 * This replaces the old "manufacture a card_instances row on scan" model -- from here on, the
 * pool of instances is fixed and comes entirely from this sheet; see server/db.ts's
 * grantCardInstance/collectCardInstance.
 *
 * DESTRUCTIVE: deletes every verified_trades, custody_events, card_instances, and
 * seen_supercards row before importing. Run via `npx tsx scripts/import-card-copies.ts` (or
 * against a scratch DB first, e.g. `DB_PATH=/tmp/x.db npx tsx scripts/import-card-copies.ts`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { db, insertCardInstanceForImport } from '../server/db';
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

// Resolve every row's card_super_id up front, so a sheet with a typo'd/unknown id fails
// loudly before anything is deleted, rather than silently dropping rows mid-import.
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

console.log(`Parsed ${rows.length} copies across ${new Set(rows.map((r) => r.card_super_id)).size} designs.`);

db.exec('BEGIN');
try {
    // Foreign keys are enforced (PRAGMA foreign_keys = ON in db.ts), so verified_trades --
    // which references custody_events, which references card_instances -- has to go first.
    db.exec('DELETE FROM verified_trades');
    db.exec('DELETE FROM custody_events');
    db.exec('DELETE FROM card_instances');
    db.exec('DELETE FROM seen_supercards');

    for (const { row, supercardN } of resolved) {
        insertCardInstanceForImport(supercardN!, row.unique_id, parseInt(row.copy_number, 10));
    }

    db.exec('COMMIT');
} catch (err) {
    db.exec('ROLLBACK');
    throw err;
}

console.log(`Imported ${rows.length} card instances. Existing ownership/seen data was cleared.`);
