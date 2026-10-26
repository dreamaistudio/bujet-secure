/**
 * backGuard — who answers the Android back button.
 *
 * Capacitor hands a back press to every listener that happens to be
 * registered, and gives none of them a way to say "I have dealt with this".
 * That is fine until two parts of the app both want the button. The pairing
 * flow steps back through its own screens; the main app closes a dialog or
 * returns to the dashboard. With no coordination, one press does both, and
 * the user is thrown out of the screen they were on.
 *
 * So anything that takes the back button over claims it here first, and the
 * main app's handler stands down for as long as that claim is held.
 *
 * Claims are counted rather than stored as a single flag: two overlays can be
 * open at once, and the main app must stay out of the way until the last one
 * has gone.
 */

import { useEffect, useRef } from "react";
import { App as CapApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

let claims = 0;

/**
 * Take ownership of the back button.
 * Call the returned function to give it back — doing so twice is harmless.
 */
export function claimBackButton(): () => void {
  claims += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    claims = Math.max(0, claims - 1);
  };
}

/** True while something more specific than the main app owns the back button. */
export function backButtonIsClaimed(): boolean {
  return claims > 0;
}

/**
 * Let the Android back button close an overlay a page owns.
 *
 * The main app's back handler only knows about its own dialogs, so a dialog
 * belonging to a page — the new-bill form, a "are you sure?" box — was
 * invisible to it. A back press fell straight through: the dialog stayed
 * open and the user was thrown back to the dashboard, losing whatever they
 * had typed. While `isOpen` is true this claims the button, so one press
 * closes the dialog and does nothing else.
 */
export function useBackButtonDismiss(isOpen: boolean, onDismiss: () => void) {
  const latest = useRef(onDismiss);
  useEffect(() => {
    latest.current = onDismiss;
  });

  useEffect(() => {
    if (!isOpen || !Capacitor.isNativePlatform()) return;
    const release = claimBackButton();
    let cancelled = false;
    let listener: { remove?: () => void } | null = null;
    CapApp.addListener("backButton", () => {
      latest.current();
    })
      .then((h) => {
        if (cancelled) h.remove();
        else listener = h;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      listener?.remove?.();
      release();
    };
  }, [isOpen]);
}
