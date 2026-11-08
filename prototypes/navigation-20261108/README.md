# Navigation structure studies

Three throwaway UI studies prompted by the sidebar screenshots on 2026-11-08.
All 91 questions, counts, replies and actions are illustrative and live only in memory.
There is no app runtime, API, database, OS notification, persistence or actual send.

Run `python3 -m http.server 4346 --bind 127.0.0.1 --directory .` here.
Open http://127.0.0.1:4346/?variant=A and compare with the bottom arrows or keyboard.

- A: one work queue, no app or round rails. Recommended: recover width while questions stay visible.
- B: a small rail, with rounds as a temporary drill-down view instead of a second column.
- C: header navigation and an on-demand question browser. Reading gets more width; the inbox
  moves behind header access when the browser is closed, changing the earlier always-visible choice.

Try Open/All, searching, round scope, selecting questions, Needs you, Changes, closing discussion,
writing a draft, and simulating a four-second reply preview. Drafts and sample picks survive view
and variant switches; reload resets the study. Utility destinations are illustrative placeholders.
The implemented notification PR and live app are separate from these studies.
