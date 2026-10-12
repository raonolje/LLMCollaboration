# 0.5.25 — Composer consistency and follow-up instructions

- Reuse the existing field styles for the work-mode selector; narrow windows wrap controls.
- Remove the duplicate stop button above the composer; retain the bottom response-stop action.
- Allow a follow-up message while a project chat/discussion is active. Capture its target, mode, model settings and attachments, then serialize execution behind the existing project chat. One pending follow-up is exposed per project in the desktop composer.
- Await the discussion conclusion before releasing the active-chat controller. Cancellation remains scoped to the current request; it does not silently discard the follow-up.
- Pending requests are in memory, not durable across application exit. The composer explicitly warns on enqueue.

Verification: 35 service tests passed, including discussion-conclusion serialization and cancellation with a queued follow-up. Desktop/mobile type checks and desktop/mobile builds passed. Isolated selector layout passed at 390/430/1100px. No real model requests or production project mutations were used. The currently running app was not closed; packaged binary verification is distinct from live UI application.
