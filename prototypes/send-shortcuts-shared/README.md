# Send shortcuts · ask 9673 (shared)

Throwaway. Host page, illustrative data and a simulated send path for three studies of sending
answers without the Review & send page. Nothing connects to the live server, its database or
any session.

The simulated send mirrors the real one: one request with a `questions` subset, one frozen
send number, one message per asking session (ADR 0005, 0011), failed deliveries kept as drafts
with Retry. Data: a current round, half answered (Release & grants), and an older round with
two unsent drafts (Clean-up); questions from two sessions, Grant checks (t2k4) and Homelab
lanes (t2m1).

The floating bar switches studies (← →), marks Homelab lanes offline to show a partial
failure, opens the State panel, and resets the data.

```sh
bunx vite --config prototypes/send-shortcuts-a/vite.config.ts   # 4371
bunx vite --config prototypes/send-shortcuts-b/vite.config.ts   # 4372
bunx vite --config prototypes/send-shortcuts-c/vite.config.ts   # 4373
```
