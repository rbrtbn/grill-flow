# Notification placement · ask 2824

Two throwaway studies of notification placement inside an illustrative grill-flow workspace.
No live API, database, messages, persistence, or OS notifications. All content is sample data.

Run `python3 -m http.server 4345 --bind 127.0.0.1 --directory .` here, then open
http://127.0.0.1:4345/?variant=A (sidebar inbox) or ?variant=B (reserved top strip).
Use the arrows or keyboard to compare. Simulate reply shows a 4-second preview;
unread counts remain. Open inbox, read a reply, and type in the discussion draft.

A is recommended: it preserves the reading and discussion space. B keeps the list taller,
but spends page height. Neither study changes the live notification placement.
