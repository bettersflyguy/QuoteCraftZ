# One Lead selection latency — 0.1.99

Previously the worker awaited executeScript across every frame. The clicked
frame completed immediately, but idle frames held the aggregate promise until
their 20-second picker timeout. Ingestion only began after that wait.

A per-round message now reports the first valid selected frame directly. The
coordinator checks the browser-supplied tab/frame identity and a unique round
token, removes its listener and timer, and cancels remaining frame pickers.
The selected DOM boundary is preserved; capture still reads only that frame.
Cancellation and bounded idle-round rearming remain supported. The panel marks
previously captured data as pending while a new selection/capture is loading.

Validation: production build passed. Four coordinator regressions cover an
immediate subframe winner despite pending other frames, stale/wrong-tab replies,
cancellation, idle completion and the bounded fallback. Targeted coordinator
and lead-boundary tests passed (10 tests). Full suite: 612 passed, one existing
vehicle-choice timing assertion took 5.238s against a 5s limit. Its isolated
rerun passed all 37 tests. Installed 0.1.99 in both existing extension folders.
Live acceptance could not be completed: Edge was closed; after launch Computer
Use returned "no monitor found for window" when attempting an input action.
No CRM writes or quote submissions were performed.
