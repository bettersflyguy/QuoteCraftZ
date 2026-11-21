# CRM connection after reload — 0.2.2

OAuth credentials remain session-only. Reloading the extension clears that session and requires Microsoft sign-in again; opening or refreshing the panel can reuse a valid session or refresh token.

The panel header now has a compact plug icon. It checks the active environment without launching an interactive account picker, then verifies CRM access with WhoAmI. Green indicates verified access; red offers explicit reconnection. Token and environment storage changes trigger a new check. The panel mode stays pinned while reconnecting.

Cancelled or blocked web authentication now returns a typed authentication error with instructions to complete the Microsoft window, or close it and reconnect. The agent picker input is constrained to its available width so it cannot overlap the adjacent connection button.

Validation: build passed; all 623 tests passed, including no-interaction session status and lost-session routing. Both existing unpacked extension folders were updated and Edge version 0.2.2 activated. Live verification confirmed the disconnected indicator and reconnect action. Edge still has an earlier Microsoft sign-in window open; reconnect correctly surfaces the incomplete-sign-in message. Authenticated acceptance remains pending the user's manual sign-in. No CRM records were created.
