"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AddSourceForm } from "./add-source-form";

/** S-09 모달. S-08 워크스페이스(task-012)가 이 컴포넌트를 불러 쓴다. */
export function AddSourceDialog({ projectId, youtubeEnabled = false }: { projectId: string; youtubeEnabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden />
          자료 추가
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>자료 추가</DialogTitle>
          <DialogDescription>{youtubeEnabled ? "PDF나 유튜브 영상을" : "PDF를"} 올리면 등록 후 분석 대기 상태가 됩니다.</DialogDescription>
        </DialogHeader>
        <AddSourceForm projectId={projectId} youtubeEnabled={youtubeEnabled} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
