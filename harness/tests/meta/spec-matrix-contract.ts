export const REQUIRED_PRIMARY_ROWS = [
  { id: "C.7", primary: "C.parallel-reads", testFile: "e2e/catalogue.spec.ts" },
  { id: "F.1", primary: "F.checkout-record", testFile: "e2e/detail.spec.ts" },
  { id: "F.2", primary: "F.return-record", testFile: "e2e/detail.spec.ts" },
  { id: "F.5", primary: "F.future-due-date", testFile: "e2e/detail.spec.ts" },
  { id: "F.7", primary: "F.post-mutation-state", testFile: "e2e/detail.spec.ts" },
] as const;

export const REQUIRED_PRIMARY_COLLATERAL: Readonly<Record<string, readonly string[]>> = {
  "C.parallel-reads": ["P.no-waterfall"],
  "F.checkout-record": ["F.lifecycle"],
  "F.return-record": ["F.lifecycle"],
  "F.future-due-date": ["E.error-shown"],
  "F.post-mutation-state": ["P.stale-after-mutate"],
};
