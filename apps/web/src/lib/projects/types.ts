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

/** 폴더 없이 가져온 자료가 들어가는 사용자 기본 폴더(projects 행, 이름으로 찾는다). */
export const INBOX_FOLDER_NAME = "받은 자료";
