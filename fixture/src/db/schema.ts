export type Category = "power-tool" | "hand-tool" | "measuring" | "safety";

export interface Item {
  id: string;
  name: string;
  category: Category;
  description: string;
  imageUrl: string;
}

export interface Member {
  id: string;
  name: string;
  email: string;
  joinedAt: string; // ISO 8601
}

export interface Loan {
  id: string;
  itemId: string;
  memberId: string;
  borrowedAt: string; // ISO 8601
  dueAt: string; // ISO 8601
  returnedAt: string | null; // ISO 8601 when returned
}

export type LoanStatus = "returned" | "overdue" | "due-soon" | "ok";

export interface StaffSession {
  staffId: string;
  name: string;
}
