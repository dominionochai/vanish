import type { AppMode } from "./types";

function requireButton(id: string): HTMLButtonElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`Expected button #${id} in the application shell.`);
  }
  return element;
}

function requirePanel(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Expected panel #${id} in the application shell.`);
  }
  return element;
}

/** Bind the existing VANISH/VERIFY controls while preserving the shell's CSS classes. */
export function bindModeTabs(onModeChange: (mode: AppMode) => void = () => undefined): void {
  const buttons: Record<AppMode, HTMLButtonElement> = {
    vanish: requireButton("mode-vanish"),
    verify: requireButton("mode-verify"),
  };
  const panels: Record<AppMode, HTMLElement> = {
    vanish: requirePanel("vanish-panel"),
    verify: requirePanel("verify-panel"),
  };

  const selectMode = (mode: AppMode): void => {
    for (const candidate of ["vanish", "verify"] as const) {
      const selected = candidate === mode;
      buttons[candidate].classList.toggle("selected", selected);
      buttons[candidate].setAttribute("aria-pressed", String(selected));
      panels[candidate].hidden = !selected;
    }
    onModeChange(mode);
  };

  buttons.vanish.addEventListener("click", () => selectMode("vanish"));
  buttons.verify.addEventListener("click", () => selectMode("verify"));
  selectMode("vanish");
}
