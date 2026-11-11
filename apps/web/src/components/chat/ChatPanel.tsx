import { MessageSquare } from "lucide-react";

// 자리표시 스텁: 질의응답(A-06)·인용 칩·생성 단계 표시는 task-016이 이 파일에 구현한다.
// selectedSourceIds는 S-08 자료 선택 체크(질의 범위)를 받을 자리다.
export function ChatPanel({
  suggestedQuestions = [],
}: {
  projectId: string;
  selectedSourceIds?: readonly string[];
  suggestedQuestions?: readonly string[];
}) {
  return (
    <section aria-labelledby="chat-title" className="flex h-full min-h-0 flex-col gap-3">
      <h2 id="chat-title" className="flex items-center gap-2 font-semibold">
        <MessageSquare aria-hidden className="size-4" />
        질문하기
      </h2>
      {suggestedQuestions.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-caption text-muted-foreground">추천 질문</p>
          <ul className="flex flex-col items-start gap-2">
            {suggestedQuestions.map((q) => (
              <li key={q} className="rounded-control border border-input px-3 py-1 text-caption break-keep">
                {q}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="mt-auto rounded-row bg-muted p-3 text-caption break-keep text-muted-foreground">
        자료에 근거한 질의응답은 준비 중입니다.
      </p>
    </section>
  );
}
