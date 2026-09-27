# Contributing

Issues and pull requests are welcome in Polish or English. Describe the problem and expected behavior. Keep upstream engines unmodified where possible.

Run `npm test` and `node --check services/server.mjs`. For pipeline changes, test upload → reconstruction → SOG → viewer on your GPU and report camera mode, engine version and result. Never commit recordings, outputs, credentials or local logs. Use synthetic footage or footage you have permission to share. Contributions are licensed under GPL-3.0-only.

Priorities: real Insta360 X4/X5 compatibility reports, clean-install testing, accessibility and cross-platform support. Unit tests do not prove reconstruction quality.
