import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';

const localISO = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const offsetDate = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localISO(date);
};

test('daily balance history carries forward and computes credit-card charges and targeted payments', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mynance-daily-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new Store(dir);
  await store.init();
  await store.saveConfig('accounts', [
    { name: 'Checking', type: 'checking' },
    { name: 'Visa', type: 'credit_card' },
    { name: 'Roth', type: 'roth_ira' },
  ]);
  const anchor = offsetDate(-2);
  await store.writeRecords('balances', [
    { date: anchor, account: 'Checking', balance: 1000, contributed: null, notes: '', id: 'checking-1' },
    { date: anchor, account: 'Visa', balance: 200, contributed: null, notes: '', id: 'visa-1' },
    { date: anchor, account: 'Roth', balance: 500, contributed: 300, notes: '', id: 'roth-1' },
  ]);
  await store.writeRecords('expenses', [
    { date: offsetDate(-1), amount: 50, vendor: 'Shop', payment_method: 'Visa', category: 'Other', subcategory: '', notes: '', id: 'expense-1' },
  ]);
  await store.writeRecords('activity', [
    { date: offsetDate(-1), amount: -25, account: 'Checking', target_account: 'Visa', category: 'Credit Card Payment', notes: '', id: 'activity-1' },
  ]);

  let result = await store.getAll();
  const card = result.records.balances.filter((b) => b.account === 'Visa');
  const roth = result.records.balances.filter((b) => b.account === 'Roth');
  assert.deepEqual(card.map((b) => b.date), [anchor, offsetDate(-1), offsetDate(0)]);
  assert.equal(card.at(-1).balance, 225);
  assert.equal(roth.at(-1).balance, 500);
  assert.equal(roth.at(-1).contributed, 300);

  // Generated rows are recomputed when transaction data changes; manual rows win.
  await store.writeRecords('expenses', [
    { date: offsetDate(-1), amount: 60, vendor: 'Shop', payment_method: 'Visa', category: 'Other', subcategory: '', notes: '', id: 'expense-1' },
  ]);
  result = await store.getAll();
  assert.equal(result.records.balances.find((b) => b.account === 'Visa' && b.date === offsetDate(0)).balance, 235);

  await store.upsertBalances([{ date: offsetDate(0), account: 'Visa', balance: 310, contributed: null, notes: 'Manual correction' }]);
  result = await store.getAll();
  const manualToday = result.records.balances.find((b) => b.account === 'Visa' && b.date === offsetDate(0));
  assert.equal(manualToday.balance, 310);
  assert.equal(manualToday.notes, 'Manual correction');
});
