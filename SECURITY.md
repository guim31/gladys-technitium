# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Secrets**: the Technitium API tokens are `secret` fields of the Gladys
  configuration. The integration reads them from Gladys at startup, keeps them
  in memory, sends them only to the server they belong to (in an
  `Authorization: Bearer` header, never in an address), and never writes them
  to `/data` nor to the logs. A token does not expire: revoke it in the
  Technitium web console (Administration → Sessions) if it leaks, and prefer a
  dedicated user with only the permissions the integration needs.
- **Stored in `/data`**: `technitium-state.json`, the update already announced
  to the scenes (a version number per server). Nothing else.
- **Network**: requests go only to the Technitium addresses typed in the
  configuration, on the local network, in HTTP or HTTPS. HTTPS certificates
  are verified unless the user ticks "Accept self-signed certificates"; the
  integration opens no port and calls no cloud service (the update check is
  made by the Technitium server itself).

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
Technitium DNS Server itself (report to
[TechnitiumSoftware/DnsServer](https://github.com/TechnitiumSoftware/DnsServer)),
and the other devices and services of your network.
