import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Folder, Inbox, Search } from "lucide-react";
import { ImportDialog } from "@/components/import/import-dialog";
import { FolderActions, NewFolderButton } from "@/components/library/folder-dialogs";
import { SourceLibrary } from "@/components/library/source-library";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { Button } from "@/components/ui/button";
import { loadFolders, type FolderOption } from "@/lib/projects/folders";
import { serverSupabaseOrNull } from "@/lib/projects/server";
import { libraryHref, listLibrarySources, parseLibraryParams, type LibraryParams, type LibrarySourceItem } from "@/lib/sources/library";
import { isYoutubeEnabled } from "@/server/youtube/service";

export const metadata: Metadata = { title: "자료 · KNOWFLOW-AI" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function loadSources(params: LibraryParams): Promise<LibrarySourceItem[] | null> {
  try {
    const supabase = await serverSupabaseOrNull();
    if (!supabase) return null;
    const { data } = await supabase.auth.getUser();
    if (!data.user) redirect("/login");
    return await listLibrarySources(supabase, params);
  } catch (e) {
    // redirect()는 예외로 동작하므로 다시 던진다
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) throw e;
    return null;
  }
}

const SELECT = "h-9 rounded-control border border-input bg-background px-3 text-caption font-medium";

// 자료 라이브러리(DESIGN.md §2-1): 가운데 좁은 단 — 세리프 제목 + 가져오기 → 폴더 카드 → 필터 줄(GET 폼) → 구분선 없는 행.
// 폴더 보기는 /sources?folder=<id>(폴더 = projects).
export default async function SourcesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = parseLibraryParams(await searchParams);
  const [folders, items] = await Promise.all([loadFolders(), loadSources(params)]);
  const folder = params.folder ? folders?.find((f) => f.id === params.folder) : undefined;
  const filtered = Boolean(params.q) || params.status !== "all" || params.type !== "all";
  const youtubeEnabled = isYoutubeEnabled();

  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6 p-4 md:p-6 desk:pt-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          {params.folder ? (
            <p className="text-caption text-muted-foreground">
              <Link href="/sources" className="underline underline-offset-4">
                자료
              </Link>{" "}
              / 폴더
            </p>
          ) : null}
          <h1 className="truncate font-serif text-display font-bold">{params.folder ? (folder?.name ?? "폴더") : "자료"}</h1>
        </div>
        <div className="flex items-center gap-1">
          {folder ? <FolderActions folder={folder} /> : null}
          <ImportDialog folders={folders ?? []} defaultFolderId={params.folder ?? undefined} youtubeEnabled={youtubeEnabled} />
        </div>
      </header>

      {params.folder ? null : <FolderCards folders={folders} />}

      <form method="get" role="search" aria-label="자료 찾기" className="flex flex-wrap items-center gap-2">
        {params.folder ? <input type="hidden" name="folder" value={params.folder} /> : null}
        <select name="status" defaultValue={params.status} aria-label="상태" className={SELECT}>
          <option value="all">상태: 전체</option>
          <option value="processing">처리 중</option>
          <option value="completed">완료</option>
          <option value="failed">실패</option>
        </select>
        <select name="type" defaultValue={params.type} aria-label="유형" className={SELECT}>
          <option value="all">유형: 전체</option>
          <option value="pdf">PDF</option>
          {youtubeEnabled || params.type === "youtube" ? <option value="youtube">유튜브</option> : null}
          <option value="url">웹</option>
        </select>
        <label className="flex h-9 min-w-0 flex-1 basis-40 items-center gap-2 rounded-control border border-input bg-background px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
          <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <input
            id="library-search"
            name="q"
            defaultValue={params.q}
            maxLength={100}
            placeholder="자료 제목 검색"
            aria-label="자료 제목 검색"
            className="min-w-0 flex-1 bg-transparent text-caption outline-none"
          />
        </label>
        <select name="sort" defaultValue={params.sort} aria-label="정렬" className={SELECT}>
          <option value="new">최신 순</option>
          <option value="old">오래된 순</option>
          <option value="name">이름 순</option>
        </select>
        <Button type="submit" variant="outline" size="sm">
          적용
        </Button>
      </form>

      {items === null ? (
        <div className="flex flex-col items-start gap-3">
          <ErrorState title="자료를 불러오지 못했습니다" />
          <Button asChild variant="outline" size="sm">
            <Link href={libraryHref(params)}>다시 시도</Link>
          </Button>
        </div>
      ) : items.length === 0 ? (
        filtered ? (
          <EmptyState icon={<Search />} title="조건에 맞는 자료가 없습니다" description="검색어나 상태·유형 조건을 바꿔 보세요." />
        ) : (
          <EmptyState
            icon={<Inbox />}
            title={params.folder ? "이 폴더에 자료가 없습니다" : "아직 가져온 자료가 없습니다"}
            description="PDF나 유튜브 영상을 가져오면 매체 이름으로 등록하고 분석을 시작합니다."
          >
            <ImportDialog folders={folders ?? []} defaultFolderId={params.folder ?? undefined} youtubeEnabled={youtubeEnabled} />
          </EmptyState>
        )
      ) : (
        <SourceLibrary items={items} showFolder={!params.folder} />
      )}
    </div>
  );
}

function FolderCards({ folders }: { folders: FolderOption[] | null }) {
  return (
    <section aria-labelledby="folders-title" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 id="folders-title" className="text-caption font-semibold text-muted-foreground">
          폴더
        </h2>
        <NewFolderButton compact />
      </div>
      {folders === null ? (
        <p className="text-caption text-muted-foreground">폴더를 불러오지 못했습니다.</p>
      ) : folders.length === 0 ? (
        <p className="text-caption text-muted-foreground break-keep">아직 폴더가 없습니다. 폴더 없이 가져온 자료는 「받은 자료」에 모입니다.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {folders.map((f) => (
            <li key={f.id}>
              <Link
                href={`/sources?folder=${f.id}`}
                className="flex h-20 flex-col justify-between rounded-row border border-border bg-card p-3 outline-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <Folder aria-hidden className="size-4 text-muted-foreground" />
                <span className="truncate font-medium">{f.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
