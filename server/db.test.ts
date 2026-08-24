import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Runs against a throwaway scratch database, never the real dev one -- server/db.ts reads
// DB_PATH at import time, so this has to be set (and the module dynamically imported) before
// any of its top-level setup runs.
const dbPath = path.join(
    os.tmpdir(),
    `campus-trade-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
);
process.env.DB_PATH = dbPath;

const {
    db,
    insertUser,
    insertCardInstanceForImport,
    findAvailableInstance,
    grantCardInstance,
    collectCardInstance,
    currentOwnerOfCardInstance,
    cardInstancesOwnedBy,
    cardInstancesCollectedBy,
    listVerifiedTrades,
    randomOtherUsers,
    revokeCardInstanceFromUser,
    clearCardInstanceHistory,
    clearAllOwnership,
    NoAvailableCopiesError,
    CardInstanceNotFoundError,
    AlreadyOwnedError,
} = await import('./db');
const { hashPassword } = await import('./auth/password');

afterAll(() => {
    for (const suffix of ['', '-shm', '-wal']) {
        fs.rmSync(dbPath + suffix, { force: true });
    }
});

// Every test shares one on-disk scratch DB (creating a fresh one per test would mean re-doing
// db.ts's whole startup dance, including its async unassignedUser seed, each time) -- reset
// the tables that would otherwise leak state between tests (verified trades / custody history
// / the pool of instances). Users and sessions are deliberately left alone: tests always mint
// fresh usernames (see makeUser), and wiping users would also delete the reserved Unassigned
// account other functions capture a reference to once at module load.
beforeEach(() => {
    db.exec('DELETE FROM verified_trades');
    db.exec('DELETE FROM custody_events');
    db.exec('DELETE FROM card_instances');
    db.exec('DELETE FROM seen_supercards');
});

let nextUsername = 0;
async function makeUser() {
    const n = nextUsername++;
    return insertUser({
        username: `student${n}`,
        email: `student${n}@mit.edu`,
        name: `Student ${n}`,
        team: 'red',
        password_hash: await hashPassword('irrelevant'),
        isAdmin: false,
    });
}

let nextUniqueId = 0;
function makeInstance(supercardN: number) {
    const uniqueId = `U${nextUniqueId++}`;
    return insertCardInstanceForImport(supercardN, uniqueId, 1);
}

describe('collectCardInstance', () => {
    it('leaves matchedExpected null when the instance has no previous owner', async () => {
        const alice = await makeUser();
        const instance = makeInstance(1);
        const result = collectCardInstance(instance.unique_id!, alice.id, null);
        expect(result.matchedExpected).toBeNull();
        expect(currentOwnerOfCardInstance(instance.id)).toBe(alice.id);
    });

    it("records 'Y' when the collector correctly names the actual previous owner", async () => {
        const alice = await makeUser();
        const bob = await makeUser();
        const instance = makeInstance(1);
        collectCardInstance(instance.unique_id!, alice.id, null);

        const result = collectCardInstance(instance.unique_id!, bob.id, alice.id);
        expect(result.matchedExpected).toBe('Y');
    });

    it("records 'N' when the collector names the wrong person", async () => {
        const alice = await makeUser();
        const bob = await makeUser();
        const carol = await makeUser();
        const instance = makeInstance(1);
        collectCardInstance(instance.unique_id!, alice.id, null);

        const result = collectCardInstance(instance.unique_id!, bob.id, carol.id);
        expect(result.matchedExpected).toBe('N');
    });

    it("records 'N' when the collector picks Unknown/Other despite there being a previous owner", async () => {
        const alice = await makeUser();
        const bob = await makeUser();
        const instance = makeInstance(1);
        collectCardInstance(instance.unique_id!, alice.id, null);

        const result = collectCardInstance(instance.unique_id!, bob.id, null);
        expect(result.matchedExpected).toBe('N');
    });

    it('throws AlreadyOwnedError when the collector already currently owns the instance', async () => {
        const alice = await makeUser();
        const instance = makeInstance(1);
        collectCardInstance(instance.unique_id!, alice.id, null);
        expect(() => collectCardInstance(instance.unique_id!, alice.id, null)).toThrow(AlreadyOwnedError);
    });

    it('throws CardInstanceNotFoundError for an unknown unique id', async () => {
        const alice = await makeUser();
        expect(() => collectCardInstance('NOPE', alice.id, null)).toThrow(CardInstanceNotFoundError);
    });
});

describe('tryFormVerifiedTrade (via collectCardInstance)', () => {
    it('forms a verified trade once both sides of a swap are correctly attributed, in either order', async () => {
        const alice = await makeUser();
        const bob = await makeUser();
        const cardA = makeInstance(1); // starts with alice
        const cardB = makeInstance(2); // starts with bob
        collectCardInstance(cardA.unique_id!, alice.id, null);
        collectCardInstance(cardB.unique_id!, bob.id, null);

        // Bob receives card A from Alice (correctly attributed) -- no complement recorded yet.
        const first = collectCardInstance(cardA.unique_id!, bob.id, alice.id);
        expect(first.matchedExpected).toBe('Y');
        expect(first.verifiedTradeFormed).toBe(false);
        expect(listVerifiedTrades()).toHaveLength(0);

        // Hours later (simulated -- no time constraint in the matching logic), Alice receives
        // card B from Bob (also correctly attributed) -- this completes the swap.
        const second = collectCardInstance(cardB.unique_id!, alice.id, bob.id);
        expect(second.matchedExpected).toBe('Y');
        expect(second.verifiedTradeFormed).toBe(true);

        const trades = listVerifiedTrades();
        expect(trades).toHaveLength(1);
        const trade = trades[0];
        // user_x is always whoever gave away card_instance_a (see tryFormVerifiedTrade) --
        // which of {alice, bob} lands in the x/a slot vs y/b depends on which side of the
        // swap got recorded second (that's the event that actually forms the trade), so check
        // the give-away invariant rather than a fixed slot assignment.
        if (trade.card_instance_a_id === cardA.id) {
            expect(trade.user_x_id).toBe(alice.id); // alice gave away card A
            expect(trade.user_y_id).toBe(bob.id);
            expect(trade.card_instance_b_id).toBe(cardB.id);
        } else {
            expect(trade.card_instance_a_id).toBe(cardB.id);
            expect(trade.user_x_id).toBe(bob.id); // bob gave away card B
            expect(trade.user_y_id).toBe(alice.id);
            expect(trade.card_instance_b_id).toBe(cardA.id);
        }
    });

    it('does not form a trade from a one-sided (unreciprocated) correct attribution', async () => {
        const alice = await makeUser();
        const bob = await makeUser();
        const cardA = makeInstance(1);
        collectCardInstance(cardA.unique_id!, alice.id, null);
        collectCardInstance(cardA.unique_id!, bob.id, alice.id);
        expect(listVerifiedTrades()).toHaveLength(0);
    });

    it('never reuses the same custody event across two verified trades', async () => {
        const alice = await makeUser();
        const bob = await makeUser();
        const carol = await makeUser();
        const cardA = makeInstance(1);
        const cardB = makeInstance(2);
        const cardC = makeInstance(3);
        collectCardInstance(cardA.unique_id!, alice.id, null);
        collectCardInstance(cardB.unique_id!, bob.id, null);
        collectCardInstance(cardC.unique_id!, bob.id, null);

        // Alice <-> Bob swap card A for card B: one verified trade.
        collectCardInstance(cardA.unique_id!, bob.id, alice.id);
        collectCardInstance(cardB.unique_id!, alice.id, bob.id);
        expect(listVerifiedTrades()).toHaveLength(1);

        // Carol claims she got card C from Bob (true), but Bob never received anything back
        // from Carol -- should not spuriously pair with the already-consumed Alice/Bob trade.
        collectCardInstance(cardC.unique_id!, carol.id, bob.id);
        expect(listVerifiedTrades()).toHaveLength(1);
    });
});

describe('grantCardInstance', () => {
    it('throws NoAvailableCopiesError once every instance of that supercard is claimed', async () => {
        const alice = await makeUser();
        const instance = makeInstance(42);
        expect(findAvailableInstance(42)?.id).toBe(instance.id);

        grantCardInstance(42, alice.id);
        expect(findAvailableInstance(42)).toBeUndefined();
        expect(() => grantCardInstance(42, alice.id)).toThrow(NoAvailableCopiesError);
    });
});

describe('revokeCardInstanceFromUser', () => {
    it('returns the instance to the available pool instead of deleting it', async () => {
        const alice = await makeUser();
        const instance = makeInstance(1);
        grantCardInstance(1, alice.id);
        expect(findAvailableInstance(1)).toBeUndefined();

        revokeCardInstanceFromUser(alice.id, instance.id);
        expect(findAvailableInstance(1)?.id).toBe(instance.id);
    });
});

describe('clearCardInstanceHistory', () => {
    it("wipes an instance's entire custody history, across every owner it's ever had", async () => {
        const alice = await makeUser();
        const bob = await makeUser();
        const instance = makeInstance(1);
        collectCardInstance(instance.unique_id!, alice.id, null);
        collectCardInstance(instance.unique_id!, bob.id, alice.id);
        expect(currentOwnerOfCardInstance(instance.id)).toBe(bob.id);

        clearCardInstanceHistory(instance.id);
        expect(currentOwnerOfCardInstance(instance.id)).toBeUndefined();
        expect(findAvailableInstance(1)?.id).toBe(instance.id);
    });

    it('deletes any verified trade built from the cleared instance, without touching others', async () => {
        const alice = await makeUser();
        const bob = await makeUser();
        const cardA = makeInstance(1);
        const cardB = makeInstance(2);
        collectCardInstance(cardA.unique_id!, alice.id, null);
        collectCardInstance(cardB.unique_id!, bob.id, null);
        collectCardInstance(cardA.unique_id!, bob.id, alice.id);
        collectCardInstance(cardB.unique_id!, alice.id, bob.id);
        expect(listVerifiedTrades()).toHaveLength(1);

        clearCardInstanceHistory(cardA.id);
        expect(listVerifiedTrades()).toHaveLength(0);
        // cardB's own custody history is untouched -- only the trade record (which referenced
        // cardA's now-deleted custody event) is gone.
        expect(currentOwnerOfCardInstance(cardB.id)).toBe(alice.id);
    });
});

describe('clearAllOwnership', () => {
    it('wipes every instance back to unclaimed, leaving the instances themselves intact', async () => {
        const alice = await makeUser();
        const bob = await makeUser();
        const cardA = makeInstance(1);
        const cardB = makeInstance(2);
        collectCardInstance(cardA.unique_id!, alice.id, null);
        collectCardInstance(cardB.unique_id!, bob.id, null);
        collectCardInstance(cardA.unique_id!, bob.id, alice.id);
        collectCardInstance(cardB.unique_id!, alice.id, bob.id);
        expect(listVerifiedTrades()).toHaveLength(1);

        clearAllOwnership();
        expect(currentOwnerOfCardInstance(cardA.id)).toBeUndefined();
        expect(currentOwnerOfCardInstance(cardB.id)).toBeUndefined();
        expect(listVerifiedTrades()).toHaveLength(0);
        expect(findAvailableInstance(1)?.id).toBe(cardA.id);
        expect(findAvailableInstance(2)?.id).toBe(cardB.id);
    });
});

describe('cardInstancesOwnedBy / cardInstancesCollectedBy', () => {
    // Regression test: these two queries used to SELECT only ci.id/ci.supercard_n, a leftover
    // from before unique_id/copy_number existed on card_instances. That silently produced rows
    // with unique_id undefined, which serializeCardInstance then coerced into JSON with the
    // uniqueId key missing entirely (JSON.stringify drops undefined values) -- and the client's
    // `new Card(...)` throws on a missing/empty uniqueId (see card.ts's checkRep). Every field
    // of CardInstanceRow needs to actually come back, not just the two that predate this table's
    // newest columns.
    it('return the full CardInstanceRow shape, including unique_id and copy_number', async () => {
        const alice = await makeUser();
        const instance = makeInstance(1);
        collectCardInstance(instance.unique_id!, alice.id, null);

        for (const row of cardInstancesOwnedBy(alice.id)) {
            expect(row.unique_id).toBeTruthy();
            expect(row.copy_number).not.toBeNull();
        }
        for (const row of cardInstancesCollectedBy(alice.id)) {
            expect(row.unique_id).toBeTruthy();
            expect(row.copy_number).not.toBeNull();
        }
    });
});

describe('randomOtherUsers', () => {
    it('excludes the given ids and never returns more than requested', async () => {
        const alice = await makeUser();
        const bob = await makeUser();
        const carol = await makeUser();
        const others = randomOtherUsers([alice.id], 2);
        expect(others.length).toBeLessThanOrEqual(2);
        expect(others.every((u) => u.id !== alice.id)).toBe(true);
        // sanity: at least bob/carol are eligible candidates
        const eligibleIds = new Set([bob.id, carol.id]);
        expect(others.every((u) => eligibleIds.has(u.id) || u.id !== alice.id)).toBe(true);
    });
});
