export interface ProjectItem {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
  sourceCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectPatch {
  name?: string;
  description?: string | null;
  archived?: boolean;
}

export type Outcome<T> =
  | { ok: true; data: T }
  | { ok: false; kind: "unauthorized" | "not_found" | "invalid" | "limit" | "conflict" | "unknown" };
