import { useEffect, useId, useRef, type ReactNode } from "react";

export function ActionDialog({
  eyebrow,
  title,
  description,
  confirmLabel,
  workingLabel,
  confirmTone = "primary",
  working = false,
  confirmDisabled = false,
  focusCancel = true,
  error,
  onCancel,
  onConfirm,
  children,
}: {
  eyebrow: string;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  workingLabel?: string;
  confirmTone?: "primary" | "danger";
  working?: boolean;
  confirmDisabled?: boolean;
  focusCancel?: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  const workingRef = useRef(working);
  onCancelRef.current = onCancel;
  workingRef.current = working;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (focusCancel) cancelRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !workingRef.current) onCancelRef.current();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      previouslyFocused?.focus();
    };
  }, [focusCancel]);

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !working) onCancel();
  }}>
    <section className="modal action-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
      <button className="icon-button modal-close" disabled={working} onClick={onCancel} aria-label="Close">×</button>
      <span className="eyebrow">{eyebrow}</span>
      <h2 id={titleId}>{title}</h2>
      <div className="action-dialog-copy" id={descriptionId}>{description}</div>
      {children}
      {error && <p className="error action-dialog-error" role="alert">{error}</p>}
      <div className="button-row action-dialog-actions">
        <button ref={cancelRef} disabled={working} onClick={onCancel}>Cancel</button>
        <button className={confirmTone} disabled={working || confirmDisabled} onClick={onConfirm}>
          {working ? workingLabel ?? "Working…" : confirmLabel}
        </button>
      </div>
    </section>
  </div>;
}
