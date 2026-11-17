// 자료 결과 화면(/sources/[id]) 표시용 형태. 폴더(=projects) 정보는 A-03 projectDetail 응답에서 서버가 골라 넘긴다.

export interface ReportFolder {
  id: string;
  name: string;
  /** 폴더 단위 요약. 자료 결과 화면에서는 표시하지 않는다(자료 요약만 보인다) */
  summary: string | null;
  suggestedQuestions: string[];
  sourceCount: number;
}

/** PDF 자료 요약 문장. 인용은 지금 그 자료에 있는 청크만, page는 그 청크의 쪽(없으면 null) */
export interface SourceSummarySentence {
  text: string;
  citations: Array<{ chunk_id: string; page: number | null }>;
}

/** GET /api/sources/:id/summary 응답(PDF 자료 요약, 유튜브 플래그와 무관) */
export interface SourceSummaryResponse {
  unavailable: boolean;
  summary: { sentences: SourceSummarySentence[] } | null;
}

export interface TocItem {
  id: string;
  label: string;
}

export const isProcessing = (status: string) => status === "queued" || status === "processing";
