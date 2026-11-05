import * as React from "react";
import { Input } from "@/components/ui/input";

export function Field({
  id,
  label,
  error,
  hint,
  ...props
}: React.ComponentProps<"input"> & { id: string; label: string; error?: string; hint?: string }) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-body font-semibold">
        {label}
        <span aria-hidden="true" className="text-destructive"> *</span>
      </label>
      <Input id={id} name={id} required aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...props} />
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-caption text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-caption text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function FormMessage({ tone, children }: { tone: "error" | "success"; children: React.ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={
        tone === "error"
          ? "rounded-control border border-destructive px-4 py-3 text-body text-destructive break-keep"
          : "rounded-control bg-muted px-4 py-3 text-body break-keep"
      }
    >
      {children}
    </p>
  );
}

export function retryText(message: string | undefined, retryAfter: number | undefined) {
  if (!message) return undefined;
  return retryAfter ? `${message} (약 ${retryAfter}초 후 가능)` : message;
}
