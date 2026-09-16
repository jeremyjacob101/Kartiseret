export const OPEN_AUTH_MENU_EVENT = "kartiseret:open-auth-menu";

export function requestAuthMenuOpen() {
  window.dispatchEvent(new Event(OPEN_AUTH_MENU_EVENT));
}
