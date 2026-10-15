# Technitium fixtures

`real/`: answers of a real Technitium DNS Server 15.6.1 (official Docker image `technitium/dns-server`), read on
15/10/2026 on an isolated Docker network, with a few DNS queries sent from another container. Nothing private in them:
the server name is `dns-server`, the addresses are the defaults of the image. `access-denied.json` is the answer to a
token whose user has no Settings permission; `invalid-token.json` to a wrong token.

The others follow the examples of `APIDOCS.md` (TechnitiumSoftware/DnsServer), with documentation addresses
(192.0.2.0/24, 198.51.100.0/24) and invented MAC addresses: `stats-last-day.json` (the counters of the documentation
example), `check-for-update-available.json`, `dhcp-scopes-enabled.json`, `dhcp-leases.json`.
