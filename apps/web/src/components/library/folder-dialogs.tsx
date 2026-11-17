"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FolderPlus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { callProjects } from "@/lib/projects/client";
import type { FolderOption } from "@/lib/projects/folders";

function ErrorLine({ message }: { message?: string }) {
  return message ? (
    <p role="alert" className="text-caption text-destructive break-keep">
      {message}
    </p>
  ) : null;
}

/** 폴더 추가(이름만). 폴더는 projects 행이다. 성공하면 사이드바·목록을 새로 읽는다. */
export function NewFolderButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = new FormData(event.currentTarget).get("name");
    setPending(true);
    setError(undefined);
    const result = await callProjects("POST", "/api/projects", { name });
    setPending(false);
    if (!result.ok) return setError(result.message ?? "폴더를 만들지 못했습니다.");
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(undefined);
      }}
    >
      <DialogTrigger asChild>
        {compact ? (
          <Button variant="ghost" size="icon-sm" aria-label="폴더 추가" title="폴더 추가">
            <FolderPlus aria-hidden />
          </Button>
        ) : (
          <Button variant="outline">
            <FolderPlus aria-hidden />
            폴더 추가
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>폴더 추가</DialogTitle>
          <DialogDescription>가져온 자료를 주제별로 묶어 둡니다.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-2 text-body font-semibold">
            폴더 이름
            <Input name="name" required maxLength={100} autoComplete="off" />
          </label>
          <ErrorLine message={error} />
          <DialogFooter>
            <Button type="submit" disabled={pending} aria-busy={pending}>
              {pending ? "만드는 중..." : "만들기"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** 폴더 보기 머리의 작업: 이름 수정 · 삭제(확인 후 소프트 삭제, 성공하면 전체 자료로). */
export function FolderActions({ folder }: { folder: FolderOption }) {
  const router = useRouter();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function run(action: () => ReturnType<typeof callProjects>, done: () => void) {
    setPending(true);
    setError(undefined);
    const result = await action();
    setPending(false);
    if (!result.ok) return setError(result.message ?? "처리하지 못했습니다.");
    done();
    router.refresh();
  }

  return (
    <div className="flex items-center gap-1">
      <Dialog
        open={renameOpen}
        onOpenChange={(o) => {
          setRenameOpen(o);
          setError(undefined);
        }}
      >
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`${folder.name} 이름 수정`}>
            <Pencil aria-hidden />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>이름 수정</DialogTitle>
            <DialogDescription>폴더 이름을 바꿉니다.</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const name = new FormData(e.currentTarget).get("name");
              void run(() => callProjects("PATCH", `/api/projects/${folder.id}`, { name }), () => setRenameOpen(false));
            }}
          >
            <Input name="name" defaultValue={folder.name} required maxLength={100} aria-label="폴더 이름" />
            <ErrorLine message={error} />
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                저장
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteOpen}
        onOpenChange={(o) => {
          setDeleteOpen(o);
          setError(undefined);
        }}
      >
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`${folder.name} 삭제`}>
            <Trash2 aria-hidden />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>폴더를 삭제할까요?</DialogTitle>
            <DialogDescription className="break-keep">
              「{folder.name}」과 안의 자료가 목록에서 사라지고, 30일 뒤 완전히 지워집니다.
            </DialogDescription>
          </DialogHeader>
          <ErrorLine message={error} />
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                void run(
                  () => callProjects("DELETE", `/api/projects/${folder.id}`),
                  () => {
                    setDeleteOpen(false);
                    router.push("/sources");
                  },
                )
              }
            >
              {pending ? "삭제 중..." : "삭제"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
