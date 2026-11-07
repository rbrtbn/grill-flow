# Label-based squad roster

The Squad overview reads Herdr's `squad.profile`, `squad.role`, `squad.run` and `squad.host`
labels. Titles, working folders, `where`, screen contents and progress never establish
membership or budget. The page's existing squad ID chooses the exact profile label.

The server's roster reader runs only fixed argv for `hc ls --all --label
squad.profile=<profile> --json` and `hc get <validated-address> --json`, without a shell.
It never sends, focuses, labels, kills or starts a terminal. Each child process is limited to
1.2 seconds and two megabytes of output. Process timeout cleanup terminates only that reader
child. It has no authority to operate the observed terminals.

Readings are cached for 60 seconds, across all page polls, with at most four concurrent reader
calls globally, 64 queued calls, 64 detail readings per profile and 16 cached profiles. Active
sessions sort before ended ones; omitted and unverified counts are visible. Refresh runs in
the background and never holds a page response open. A missing or failed reading stays
unavailable or stale; prior successful metadata retains its original checked time. A disconnected
host retains its last rows marked stale. Preview servers do not run roster reads.

Only projected metadata reaches the page. Raw `hc get` output, argv, screen contents and stderr
are neither returned, logged nor stored. The roster writes no SQLite events or other state.

Core status and page waits are separate columns. Waits count eligible open questions, unsent
drafts and published open owner steps routed to that address. A run label selects its exact
published grill; an unknown explicit run does not fall back to a route match. Without a run
label, published routes may link pages, including owner-only work. Other profiles' pages do not
contribute. A route match is not proof of a native runtime identity or current ownership after
an address is reused. Ended sessions are collapsed, and leftover page items remain labelled.

Account budgets read Not reported. Core progress is task progress, and no collector or quota
inference is part of this roster. Old snapshots without the optional roster field remain valid.
