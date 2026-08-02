import type { Item, Loan, Member } from "./schema";
import { seedItems, seedLoans, seedMembers, NOW } from "./seed";

/**
 * In-process store. Hermetic by design: no native modules, no network, no disk.
 * The harness restarts the server between runs, which restores the seed.
 */
type Store = { items: Item[]; members: Member[]; loans: Loan[] };

const globalForDb = globalThis as unknown as { __store?: Store };

function store(): Store {
  if (!globalForDb.__store) {
    globalForDb.__store = {
      items: structuredClone(seedItems),
      members: structuredClone(seedMembers),
      loans: structuredClone(seedLoans),
    };
  }
  return globalForDb.__store;
}

/** Fixed clock. Always use this instead of `new Date()` / `Date.now()`. */
export function now(): Date {
  return new Date(process.env.BENCH_NOW ?? NOW);
}

/** Artificial latency so parallel-vs-sequential fetching is observable. */
const LATENCY_MS = Number(process.env.BENCH_LATENCY_MS ?? 120);

/**
 * Optional call tracing. When BENCH_TRACE_FILE is set, each read appends
 * {name, start, end} so the grader can see which reads overlapped.
 * Has no effect in normal use.
 */
function trace(name: string, start: number) {
  const file = process.env.BENCH_TRACE_FILE;
  if (!file) return;
  const line = JSON.stringify({ name, start, end: Date.now() }) + "\n";
  import("node:fs").then((fs) => fs.appendFileSync(file, line)).catch(() => {});
}

const delay = async (name: string) => {
  const start = Date.now();
  await new Promise((r) => setTimeout(r, LATENCY_MS));
  trace(name, start);
};

export async function listItems(): Promise<Item[]> {
  await delay("listItems");
  if (process.env.BENCH_FAIL_ITEMS) throw new Error("catalogue unavailable");
  return structuredClone(store().items);
}

export async function countItems(): Promise<number> {
  await delay("countItems");
  return store().items.length;
}

export async function listCategories(): Promise<string[]> {
  await delay("listCategories");
  return [...new Set(store().items.map((i) => i.category))].sort();
}

export async function getItem(id: string): Promise<Item | null> {
  await delay("getItem");
  return structuredClone(store().items.find((i) => i.id === id) ?? null);
}

export async function listMembers(): Promise<Member[]> {
  await delay("listMembers");
  return structuredClone(store().members);
}

export async function getMember(id: string): Promise<Member | null> {
  await delay("getMember");
  return structuredClone(store().members.find((m) => m.id === id) ?? null);
}

export async function listLoans(): Promise<Loan[]> {
  await delay("listLoans");
  return structuredClone(store().loans);
}

export async function listLoansForItem(itemId: string): Promise<Loan[]> {
  await delay("listLoansForItem");
  return structuredClone(store().loans.filter((l) => l.itemId === itemId));
}

export async function findOpenLoan(itemId: string): Promise<Loan | null> {
  await delay("findOpenLoan");
  return structuredClone(
    store().loans.find((l) => l.itemId === itemId && l.returnedAt === null) ?? null,
  );
}

/**
 * Thrown by `insertLoan` when the item already has an open loan at the moment
 * the write lands. The store enforces one open loan per item; reading first and
 * writing later is not enough, because the answer can change in between.
 */
export class ItemOnLoanError extends Error {
  constructor(readonly itemId: string) {
    super(`Item ${itemId} already has an open loan`);
    this.name = "ItemOnLoanError";
  }
}

/** Thrown by `closeLoan` when the loan has already been returned. */
export class LoanAlreadyClosedError extends Error {
  constructor(readonly loanId: string) {
    super(`Loan ${loanId} is already closed`);
    this.name = "LoanAlreadyClosedError";
  }
}

export async function insertLoan(loan: Omit<Loan, "id">): Promise<Loan> {
  await delay("insertLoan");
  const s = store();
  if (s.loans.some((l) => l.itemId === loan.itemId && l.returnedAt === null)) {
    throw new ItemOnLoanError(loan.itemId);
  }
  const created: Loan = { ...loan, id: `lon-${String(s.loans.length + 1).padStart(3, "0")}` };
  s.loans.push(created);
  return structuredClone(created);
}

export async function closeLoan(loanId: string, returnedAt: string): Promise<Loan | null> {
  await delay("closeLoan");
  const s = store();
  const loan = s.loans.find((l) => l.id === loanId);
  if (!loan) return null;
  if (loan.returnedAt !== null) throw new LoanAlreadyClosedError(loanId);
  loan.returnedAt = returnedAt;
  return structuredClone(loan);
}
