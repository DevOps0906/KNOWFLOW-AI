// A-11 /api/sources/:id/captures 응답 형태(task-030). 서버 핸들러와 화면이 함께 쓴다.

export const CAPTURE_LIMIT = 20;

export interface CaptureItem {
  id: string;
  /** 장면 카드 id. 장면이 재처리로 바뀌면 null */
  moment_id: string | null;
  t_seconds: number;
  /** 짧게 유효한 서명 URL(비공개 버킷) */
  url: string;
  /** 그 시각의 원본 영상 링크(video_id로 만든다) */
  source_url: string;
  created_at: string;
}

/** GET 응답. 채널명은 메타데이터가 있을 때만(캡처 행에 복사하지 않는다) */
export interface CapturesResponse {
  unavailable: boolean;
  limit: number;
  channel_title: string | null;
  items: CaptureItem[];
}

/** 플래그가 꺼졌을 때 모든 호출의 422 오류 코드 */
export const CAPTURE_DISABLED_CODE = "capture_disabled";
