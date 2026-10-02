import type { ReactNode } from "react";
import { Navigation } from "./navigation";

export const studentAction =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
export const studentLink =
  "inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-medium text-primary hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring";

export function StudentShell({
  user,
  children,
}: {
  user: { name: string; email: string; role?: string | null };
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col bg-background lg:flex-row">
      <Navigation user={user} isAdmin={user.role === "admin"} />
      {children}
    </div>
  );
}

export function StudentPage({
  children,
  wide = false,
}: {
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <main
      id="student-main"
      tabIndex={-1}
      className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-10"
    >
      <div
        className={`mx-auto space-y-8 ${wide ? "max-w-[1440px]" : "max-w-6xl"}`}
      >
        {children}
      </div>
    </main>
  );
}

export function StudentHeader({
  title,
  description,
  context,
  action,
}: {
  title: string;
  description?: string;
  context?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:flex-wrap">
      <div className="min-w-0 flex-1">
        {context && (
          <div className="mb-3 text-sm text-muted-foreground">{context}</div>
        )}
        <h1
          dir="auto"
          className="break-words text-2xl font-semibold tracking-tight sm:text-3xl"
        >
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {action}
    </header>
  );
}
