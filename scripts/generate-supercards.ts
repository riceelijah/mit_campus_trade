/**
 * One-off script: reads the Campus Trade Master Content Sheet CSV and writes out
 * src/data/supercards.json, an array of SupercardData objects the frontend can import
 * directly (no CSV parser shipped to the browser).
 *
 * Run via `npm run generate:data`. Re-run whenever the master content sheet changes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { parseSupercardRow } from '../src/card';

const here = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.resolve(here, '../Campus Trade Master Content Sheet - Ordered Card Master(in)(1).csv');
const OUT_PATH = path.resolve(here, '../src/data/supercards.json');

const csvText = fs.readFileSync(CSV_PATH, 'utf-8');
const rows: Record<string, string>[] = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
});

const data = rows.map(parseSupercardRow);

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify(data, null, 2) + '\n');

console.log(`Wrote ${data.length} supercards to ${path.relative(process.cwd(), OUT_PATH)}`);
