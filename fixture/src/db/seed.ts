import type { Item, Loan, Member } from "./schema";

/**
 * Fixed clock. Every date below is relative to this instant so that loan
 * statuses are deterministic. The harness pins `BENCH_NOW` to the same value.
 */
export const NOW = "2026-03-15T12:00:00.000Z";

const hours = (n: number) =>
  new Date(Date.parse(NOW) + n * 3600_000).toISOString();

export const seedItems: Item[] = [
  { id: "itm-001", name: "Cordless Drill", category: "power-tool", description: "18V brushless drill with two batteries.", imageUrl: "/img/lending-desk-tool.svg" },
  { id: "itm-002", name: "Impact Driver", category: "power-tool", description: "Compact 1/4in hex impact driver.", imageUrl: "/img/lending-desk-tool.svg" },
  { id: "itm-003", name: "Circular Saw", category: "power-tool", description: "7-1/4in blade, corded.", imageUrl: "/img/lending-desk-tool.svg" },
  { id: "itm-004", name: "Claw Hammer", category: "hand-tool", description: "16oz steel claw hammer.", imageUrl: "/img/lending-desk-tool.svg" },
  { id: "itm-005", name: "Socket Set", category: "hand-tool", description: "40-piece metric socket set.", imageUrl: "/img/lending-desk-tool.svg" },
  { id: "itm-006", name: "Pipe Wrench", category: "hand-tool", description: "14in heavy duty pipe wrench.", imageUrl: "/img/lending-desk-tool.svg" },
  { id: "itm-007", name: "Laser Measure", category: "measuring", description: "Range 50m, +/- 2mm.", imageUrl: "/img/lending-desk-tool.svg" },
  { id: "itm-008", name: "Spirit Level", category: "measuring", description: "1200mm box-section level.", imageUrl: "/img/lending-desk-tool.svg" },
  { id: "itm-009", name: "Moisture Meter", category: "measuring", description: "Pin-type moisture meter for timber.", imageUrl: "/img/lending-desk-tool.svg" },
  { id: "itm-010", name: "Safety Harness", category: "safety", description: "Full-body harness, EN 361.", imageUrl: "/img/lending-desk-tool.svg" },
  { id: "itm-011", name: "Ear Defenders", category: "safety", description: "32dB SNR over-ear defenders.", imageUrl: "/img/lending-desk-tool.svg" },
  { id: "itm-012", name: "Drill Press", category: "power-tool", description: "Bench-mounted 13-speed drill press.", imageUrl: "/img/lending-desk-tool.svg" },
  // Differs from itm-014 only by case. Matching has to fold case on both sides,
  // not merely lower-case the needle.
  { id: "itm-013", name: "Tile Cutter", category: "hand-tool", description: "600mm manual tile cutter.", imageUrl: "/img/lending-desk-tool.svg" },
  { id: "itm-014", name: "TILE CUTTER XL", category: "power-tool", description: "900mm wet tile saw.", imageUrl: "/img/lending-desk-tool.svg" },
  // Regex metacharacters in the name. A filter built with `new RegExp(q)` either
  // throws on this input or silently matches the wrong set.
  { id: "itm-015", name: "C-Clamp (150mm)", category: "hand-tool", description: "Cast iron G-clamp, 150mm jaw.", imageUrl: "/img/lending-desk-tool.svg" },
  // Non-ASCII plus an apostrophe: exercises case folding and HTML escaping.
  { id: "itm-016", name: "Étau d'Établi", category: "hand-tool", description: "Bench vice, 125mm jaws.", imageUrl: "/img/lending-desk-tool.svg" },
  { id: "itm-017", name: "Rotary Hammer", category: "power-tool", description: "SDS-plus rotary hammer, 3.5J.", imageUrl: "/img/lending-desk-tool.svg" },
  { id: "itm-018", name: "Scaffold Tower", category: "safety", description: "4m alloy tower, EN 1004.", imageUrl: "/img/lending-desk-tool.svg" },
  { id: "itm-019", name: "Torque Wrench", category: "hand-tool", description: "1/2in drive, 40-210Nm.", imageUrl: "/img/lending-desk-tool.svg" },
  { id: "itm-020", name: "Thermal Camera", category: "measuring", description: "160x120 thermal imager.", imageUrl: "/img/lending-desk-tool.svg" },
  { id: "itm-021", name: "Dust Mask Pack", category: "safety", description: "FFP3 masks, box of 10.", imageUrl: "/img/lending-desk-tool.svg" },
  { id: "itm-022", name: "Angle Grinder", category: "power-tool", description: "115mm grinder with guard.", imageUrl: "/img/lending-desk-tool.svg" },
  { id: "itm-023", name: "Chalk Line", category: "measuring", description: "30m chalk line reel.", imageUrl: "/img/lending-desk-tool.svg" },
  { id: "itm-024", name: "Knee Pads", category: "safety", description: "Gel knee pads, one size.", imageUrl: "/img/lending-desk-tool.svg" },
  // itm-025..itm-028 each carry an open loan and exist so the return tests have
  // an item nothing else mutates. itm-029 has none, for the not-on-loan path.
  { id: "itm-025", name: "Bench Grinder", category: "power-tool", description: "150mm double-ended bench grinder.", imageUrl: "/img/lending-desk-tool.svg" },
  { id: "itm-026", name: "Cable Reel", category: "safety", description: "25m 16A extension reel.", imageUrl: "/img/lending-desk-tool.svg" },
  { id: "itm-027", name: "Heat Gun", category: "power-tool", description: "2000W two-speed heat gun.", imageUrl: "/img/lending-desk-tool.svg" },
  { id: "itm-028", name: "Stud Finder", category: "measuring", description: "Multi-scanner for stud and cable.", imageUrl: "/img/lending-desk-tool.svg" },
  { id: "itm-029", name: "Tin Snips", category: "hand-tool", description: "250mm straight-cut tin snips.", imageUrl: "/img/lending-desk-tool.svg" },
];

export const seedMembers: Member[] = [
  { id: "mbr-001", name: "Ada Okonkwo", email: "ada@example.org", joinedAt: "2024-01-12T09:00:00.000Z" },
  { id: "mbr-002", name: "Bruno Silva", email: "bruno@example.org", joinedAt: "2024-06-03T09:00:00.000Z" },
  { id: "mbr-003", name: "Chen Wei", email: "chen@example.org", joinedAt: "2025-02-20T09:00:00.000Z" },
  { id: "mbr-004", name: "Dara Nwosu", email: "dara@example.org", joinedAt: "2025-11-08T09:00:00.000Z" },
  // The name of mbr-003 is a strict prefix of this one. Resolving a member by
  // name rather than by id picks the wrong person.
  { id: "mbr-005", name: "Chen Weiming", email: "weiming@example.org", joinedAt: "2026-01-15T09:00:00.000Z" },
];

/** Eight returned loans on itm-018, for history under volume. */
const towerHistory: Loan[] = Array.from({ length: 8 }, (_, i) => ({
  id: `lon-${String(12 + i).padStart(3, "0")}`,
  itemId: "itm-018",
  memberId: seedMembers[i % 4].id,
  borrowedAt: hours(-1000 + i * 50),
  dueAt: hours(-900 + i * 50),
  returnedAt: hours(-910 + i * 50),
}));

export const seedLoans: Loan[] = [
  // Open + overdue (due 72h before NOW). The only overdue loan in the seed.
  { id: "lon-001", itemId: "itm-003", memberId: "mbr-001", borrowedAt: hours(-240), dueAt: hours(-72), returnedAt: null },
  // Open + due-soon (due 24h after NOW)
  { id: "lon-002", itemId: "itm-007", memberId: "mbr-002", borrowedAt: hours(-100), dueAt: hours(24), returnedAt: null },
  // Open + ok (due 200h after NOW)
  { id: "lon-003", itemId: "itm-010", memberId: "mbr-003", borrowedAt: hours(-20), dueAt: hours(200), returnedAt: null },
  // Closed history on itm-001
  { id: "lon-004", itemId: "itm-001", memberId: "mbr-001", borrowedAt: hours(-800), dueAt: hours(-600), returnedAt: hours(-610) },
  { id: "lon-005", itemId: "itm-001", memberId: "mbr-004", borrowedAt: hours(-500), dueAt: hours(-300), returnedAt: hours(-290) },
  // Closed history on itm-005
  { id: "lon-006", itemId: "itm-005", memberId: "mbr-002", borrowedAt: hours(-400), dueAt: hours(-200), returnedAt: hours(-205) },
  // Identical borrowedAt on itm-013: ordering must stay stable rather than
  // depending on an unstable comparator or on which record was read first.
  { id: "lon-007", itemId: "itm-013", memberId: "mbr-001", borrowedAt: hours(-300), dueAt: hours(-100), returnedAt: hours(-120) },
  { id: "lon-008", itemId: "itm-013", memberId: "mbr-005", borrowedAt: hours(-300), dueAt: hours(-100), returnedAt: hours(-110) },
  // itm-017 carries a returned loan AND a newer open one. Whether an item is on
  // loan is a question about open loans, not about the most recent loan.
  { id: "lon-009", itemId: "itm-017", memberId: "mbr-002", borrowedAt: hours(-600), dueAt: hours(-400), returnedAt: hours(-420) },
  { id: "lon-010", itemId: "itm-017", memberId: "mbr-004", borrowedAt: hours(-30), dueAt: hours(200), returnedAt: null },
  // Closed history on itm-016 (non-ASCII item name)
  { id: "lon-011", itemId: "itm-016", memberId: "mbr-003", borrowedAt: hours(-700), dueAt: hours(-500), returnedAt: hours(-505) },
  ...towerHistory,
  // Open loans reserved for the return flow. All are comfortably in date so they
  // do not disturb the overdue filter, which must still see only lon-001.
  { id: "lon-020", itemId: "itm-025", memberId: "mbr-001", borrowedAt: hours(-40), dueAt: hours(200), returnedAt: null },
  { id: "lon-021", itemId: "itm-026", memberId: "mbr-002", borrowedAt: hours(-40), dueAt: hours(200), returnedAt: null },
  { id: "lon-022", itemId: "itm-027", memberId: "mbr-003", borrowedAt: hours(-40), dueAt: hours(200), returnedAt: null },
  { id: "lon-023", itemId: "itm-028", memberId: "mbr-004", borrowedAt: hours(-40), dueAt: hours(200), returnedAt: null },
];
