"use client";

import { useState, type ReactNode, type KeyboardEvent } from "react";
import "./study-workspace.css";

export type WorkspacePanel = { id: string; label: string; content: ReactNode };
export function StudyWorkspace({
  material,
  panels,
  initialPanel,
}: {
  material: ReactNode;
  panels: WorkspacePanel[];
  initialPanel?: string;
}) {
  const first = panels.some((panel) => panel.id === initialPanel)
    ? initialPanel!
    : panels[0].id;
  const [active, setActive] = useState(first);
  const [visited, setVisited] = useState([first]);
  function select(id: string) {
    setActive(id);
    setVisited((current) =>
      current.includes(id) ? current : [...current, id],
    );
  }
  function keyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const rtl = document.documentElement.dir === "rtl";
    const step =
      event.key === "ArrowRight"
        ? rtl
          ? -1
          : 1
        : event.key === "ArrowLeft"
          ? rtl
            ? 1
            : -1
          : 0;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? panels.length - 1
          : step
            ? (index + step + panels.length) % panels.length
            : null;
    if (next === null) return;
    event.preventDefault();
    select(panels[next].id);
    document.getElementById(`tool-tab-${panels[next].id}`)?.focus();
  }
  return (
    <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
      <section aria-label="Lecture material" className="min-w-0">
        {material}
      </section>
      <aside
        aria-label="Study tools"
        className="min-w-0 rounded-xl border bg-card xl:sticky xl:top-6"
      >
        <div
          role="tablist"
          aria-label="Study tools"
          className="flex flex-wrap gap-1 border-b p-2"
        >
          {panels.map((panel, index) => (
            <button
              key={panel.id}
              role="tab"
              id={`tool-tab-${panel.id}`}
              aria-selected={active === panel.id}
              aria-controls={`tool-panel-${panel.id}`}
              tabIndex={active === panel.id ? 0 : -1}
              onClick={() => select(panel.id)}
              onKeyDown={(event) => keyDown(event, index)}
              className={`min-h-11 rounded-lg px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring ${active === panel.id ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted"}`}
            >
              {panel.label}
            </button>
          ))}
        </div>
        {panels.map((panel) => (
          <div
            key={panel.id}
            role="tabpanel"
            id={`tool-panel-${panel.id}`}
            aria-labelledby={`tool-tab-${panel.id}`}
            hidden={active !== panel.id}
            tabIndex={0}
            className="workspace-panel max-h-[70svh] min-w-0 overflow-auto break-words p-4 focus-visible:outline-2 focus-visible:outline-ring sm:p-5 xl:max-h-[calc(100dvh-9rem)]"
          >
            {visited.includes(panel.id) ? panel.content : null}
          </div>
        ))}
      </aside>
    </div>
  );
}
