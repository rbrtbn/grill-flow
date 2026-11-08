# Sidebar notification inbox

Rob selected the sidebar study A in `grill-flow-squad-channel` Q13, submission 2850.
The captured comparison is on branch `prototype/notification-placement-2824`.

The tray and previews sit below the round/question browser in the question pane.
Their own bounded scroll area keeps the reading pane and discussion clear, including
expanded discussion and Conversations. The tradeoff is fewer visible question rows.
At least 80 pixels remain for navigation; filter tools can scroll on short screens.
The tray button stays at the top of the inbox while its previews scroll.

Existing collapse/reopen, unread retention, individual dismissal and answer-read behavior
stay unchanged. Expiry only hides previews. The four-second lifetime is a separate change
in PR #5. Legacy reading routes retain their existing notification layout.

Validation uses the existing expiry/unread scenes plus sidebar placement checks during
regular, expanded and full-page discussion. Static fixture renders use 135 sample questions
and five replies, without a runtime, server, live data or network access.
