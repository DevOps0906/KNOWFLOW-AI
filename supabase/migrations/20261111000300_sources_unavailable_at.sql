-- sources.unavailable_at: 원본을 더 이상 쓸 수 없게 된 시각(ADR-0006, 05#8 비활성).
-- status·deleted_at과 별개이며, 값이 있으면 검색·인용에서 제외한다(판정은 task-014 검색 함수).
alter table public.sources add column unavailable_at timestamptz;

comment on column public.sources.unavailable_at is
  '원본 비활성 시각. null이면 사용 가능. status·deleted_at과 별개(05#8)';
