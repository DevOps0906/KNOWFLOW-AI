"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Archive, ArchiveRestore, Pencil, Plus, Trash2 } from "lucide-react";
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
import type { ProjectItem } from "@/lib/projects/types";

function ErrorLine({ message }: { message?: string }) {
  return message ? (
    <p role="alert" className="text-caption text-destructive break-keep">
      {message}
    </p>
  ) : null;
}

/** 새 프로젝트 만들기(이름·설명). 성공하면 목록을 새로 읽는다. */
export function NewProjectButton({ variant = "default" }: { variant?: "default" | "outline" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(undefined);
    const result = await callProjects("POST", "/api/projects", {
      name: form.get("name"),
      description: form.get("description"),
    });
    setPending(false);
    if (!result.ok) return setError(result.message ?? "프로젝트를 만들지 못했습니다.");
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setError(undefined); }}>
      <DialogTrigger asChild>
        <Button variant={variant}>
          <Plus aria-hidden />
          새 프로젝트
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>새 프로젝트</DialogTitle>
          <DialogDescription>자료를 모아 질문하고 리포트를 만들 작업 공간입니다.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-2 text-body font-semibold">
            프로젝트 이름
            <Input name="name" required maxLength={100} autoComplete="off" />
          </label>
          <label className="flex flex-col gap-2 text-body font-semibold">
            설명 (선택)
            <Input name="description" maxLength={1000} autoComplete="off" />
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

/** 행 단위 작업: 이름 수정 · 보관/복원 · 삭제(확인 후 소프트 삭제) */
export function ProjectRowActions({ project }: { project: ProjectItem }) {
  const router = useRouter();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const archived = project.status === "archived";

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
    <div className="flex flex-wrap items-center gap-1">
      <Dialog open={renameOpen} onOpenChange={(o) => { setRenameOpen(o); setError(undefined); }}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`${project.name} 이름 수정`}>
            <Pencil aria-hidden />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>이름 수정</DialogTitle>
            <DialogDescription>프로젝트 이름을 바꿉니다.</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const name = new FormData(e.currentTarget).get("name");
              void run(() => callProjects("PATCH", `/api/projects/${project.id}`, { name }), () => setRenameOpen(false));
            }}
          >
            <Input name="name" defaultValue={project.name} required maxLength={100} aria-label="프로젝트 이름" />
            <ErrorLine message={error} />
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                저장
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Button
        variant="ghost"
        size="icon"
        disabled={pending}
        aria-label={`${project.name} ${archived ? "복원" : "보관"}`}
        onClick={() => void run(() => callProjects("PATCH", `/api/projects/${project.id}`, { archived: !archived }), () => {})}
      >
        {archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
      </Button>

      <Dialog open={deleteOpen} onOpenChange={(o) => { setDeleteOpen(o); setError(undefined); }}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`${project.name} 삭제`}>
            <Trash2 aria-hidden />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>프로젝트를 삭제할까요?</DialogTitle>
            <DialogDescription className="break-keep">
              「{project.name}」과 안의 자료가 목록에서 사라지고, 30일 뒤 완전히 지워집니다.
            </DialogDescription>
          </DialogHeader>
          <ErrorLine message={error} />
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => void run(() => callProjects("DELETE", `/api/projects/${project.id}`), () => setDeleteOpen(false))}
            >
              {pending ? "삭제 중..." : "삭제"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {error && !renameOpen && !deleteOpen ? <ErrorLine message={error} /> : null}
    </div>
  );
}
