# Security

Vault Connect Bridge is local-only:

- no network requests, telemetry or accounts;
- connections and settings are stored only in this plugin's own `data.json`;
- other vaults are read-only: it checks that folders and files exist and lists note names, only when you use the link picker or search. It never reads note contents, and never writes to, creates in or deletes from another vault.

If you find a security problem, please report it privately through GitHub's "Report a vulnerability" on this repository (Security tab) instead of opening a public issue.
