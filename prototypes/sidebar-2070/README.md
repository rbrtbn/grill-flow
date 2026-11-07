# Sidebar studies · ask 2070

Four sidebar structures in the existing grill-flow visual system. Switch with the floating bar
or `?variant=A`, `B`, `C`, `D`. Question data is illustrative; all actions stay in memory.
This is a throwaway comparison, with no connection to the live server or its database.

```sh
bunx vite --config prototypes/sidebar-2070/vite.config.ts
```

Open `http://127.0.0.1:4344/prototypes/sidebar-2070/`.

- A · Compact stack: visible controls and conventional navigation, one scrollable question list.
- B · Separate rail: application destinations alongside questions, recovering vertical space.
- C · Filters on demand: search and one filter summary, with explicit active-filter chips.
- D · Round navigator: choose a round or agent first, then scan its smaller question list.

Try search, status and urgency filters, Round/Agent grouping, foldable groups, answering a
question, and opening Discussion. The 30/60/135 controls exercise list density. No choice has
been promoted to the production sidebar.
