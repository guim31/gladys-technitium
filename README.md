# Technitium DNS for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that
follows and controls [Technitium DNS Server](https://technitium.com/dns/), the
open source DNS server, ad blocker and DHCP server, through its HTTP API, over
the local network. No cloud, no account.

> **Tested against a real Technitium DNS Server 15.6.1** (the official Docker
> image), not yet with a real Gladys installation: feedback welcome in the
> [issues](https://github.com/guim31/gladys-technitium/issues).

## Features

- **One device per server** (up to three, each with its own address and API
  token): the **blocking switch** (off: a 5-minute pause by default, up to 60
  minutes, or until turned back on, as configured), the DNS queries of the last
  hour and of the last day, the blocked queries and their share, the clients,
  the zones, the blocked domains, **update available**, the version, and the
  **DHCP leases** when the server runs a DHCP scope.
- **Dashboard widget** "Technitium DNS": the day's figures of every server (or
  one), the state of each server (blocking, paused with the minutes left,
  disabled, unreachable), the last hour, the clients, the blocked domains, the
  DHCP leases and the available update, and four direct buttons: **Pause 5
  min**, **Pause 30 min**, **Pause…** (a duration typed in a form, Gladys 5.2.0
  or later) and **Resume**.
- **Scene triggers**: _Technitium blocking paused_ (with the length of the
  pause, and whether it came from Gladys or from elsewhere), _Technitium
  blocking resumed_ (by the end of the pause, Gladys or elsewhere), _Technitium
  update available_ (once per version, across restarts), _Technitium no longer
  answers_ and _Technitium answers again_.
- **Scene actions**: _Pause Technitium blocking_ (one server or all of them, for
  a number of minutes), _Resume Technitium blocking_, _Flush the Technitium DNS
  cache_, and _Read the Technitium statistics_ (a sentence and the figures, for
  a message or a spoken report).
- A **Test the connection** button in the Configuration screen, and a
  connection status that names the server and the problem (token refused,
  missing permission, certificate, wrong port…).
- A **transport badge** per device: local, or unreachable.
- Every text in English, French, German and Spanish.

## Requirements

- Gladys Assistant **5.1.0** or later (widgets, scene triggers and actions).
  The _Pause…_ button of the widget needs **5.2.0** (forms behind widget
  buttons); on 5.1, it answers that Gladys needs an update.
- **Technitium DNS Server 15.0** or later (the version that takes the token in
  an `Authorization` header), its web console reachable from Gladys (port 5380
  by default).
- An **API token**: web console → user menu → **Create API Token**. Its user
  needs Dashboard (view) and Settings (view, and modify to pause); Cache
  (delete) for the flush action and DHCP Server (view) for the leases are
  optional.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-technitium`
   (or install **Technitium DNS** from the catalog once it is listed).
2. In **Configuration**, enter the address of your server (`192.168.1.2` gets
   port 5380; or the full URL of its console, `https://dns.example.net`), its
   API token and a name; up to two more servers below. Save, then click **Test
   the connection**.
3. Open the **Discover** tab and add the devices.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

- Every call carries the token in an `Authorization: Bearer` header (never in
  the address). Technitium answers HTTP 200 with a JSON `status`: `ok`,
  `error` ("Access was denied." for a missing permission), `invalid-token`.
- Every refresh interval (30 s to 5 min, 1 min by default), each server is read
  with `/api/settings/get` (version, `enableBlocking`,
  `temporaryDisableBlockingTill`), `/api/dashboard/stats/get` for `LastHour`
  and `LastDay`, and `/api/dhcp/scopes/list` + `/api/dhcp/leases/list`;
  `/api/user/checkForUpdate` every six hours (each check makes the server ask
  the Technitium update service). The devices are published with
  `should_poll: false`: the interval is beyond the list of the Gladys
  scheduler, and the scene events must fire even for a server whose device was
  not added.
- Only the values that changed are sent to Gladys (`publishChangedStates` of
  the SDK), an unchanged value again every six hours, and all of them when a
  device is added or Gladys reconnects.
- A pause is `/api/settings/temporaryDisableBlocking?minutes=N`; resume is
  `/api/settings/set?enableBlocking=true`, which also stops a running pause.
  Turning the blocking off "until turned back on" during a pause sends
  `enableBlocking=true` then `false`: `false` alone leaves the pause timer
  running, and it would turn the blocking back on at its end (checked on a real
  server).
- A blocking change seen within 30 s of a Gladys command is Gladys' own; any
  other is "outside Gladys", or "end of the pause" when it happens at the time
  the pause was due to end.
- A server is "down" after two failed reads in a row (the second one 15 s
  after the first), counting only silence: a refused token is a configuration
  problem, shown in the connection status.
- `/data/technitium-state.json` remembers the update already announced, so a
  restart does not announce it again. Nothing else is stored; tokens stay in
  the Gladys configuration and never reach the logs.
- HTTP(S) runs on `node:http` / `node:https`: `fetch` cannot accept a
  self-signed certificate for one server only.

## Checked on a real server, and what was not

On 16/10/2026 the Docker image of the integration was built and run with the
Gladys sandbox constraints (read-only root, all capabilities dropped, 256 MB,
bridge network, no port published) next to a real Technitium DNS Server 15.6.1
(`technitium/dns-server`) on an isolated Docker network:

- without Gladys, the container retries the connection calmly (no crash loop,
  no secret in the logs), about 19 MB of memory at rest;
- the whole integration (with the SDK's fake Gladys) against the real server:
  discovery, states, widget within the core budget, pause from a scene, resume
  from the widget, the switch turned off "until turned back on" during a pause
  (still off after the end of the pause), cache flush, statistics sentence,
  "Test the connection", a wrong token, a token without the Settings
  permission, a wrong port;
- the answers recorded there are the test fixtures
  (`test/fixtures/technitium/real/`).

Not checked: a server with real DHCP leases (the parsing follows the
documented answer), an available update (documented answer), HTTPS on port
53443, a Technitium cluster, and the widget and its
_Pause…_ form in a real Gladys.

## Limitations

- Three servers at most per Gladys. A cluster is seen server by server.
- The day is the one of the Technitium dashboard: the 24 full hours before the
  current one, so it lags up to an hour behind.
- The share blocked is rounded in the device (Gladys has no decimal percentage
  sensor); the widget shows one decimal.
- No presence detection from the DHCP leases, no management of zones, block
  lists, allowed or blocked domains or DHCP scopes: that stays in the web
  console.
- Names ending in `.local` do not resolve inside the integration container:
  use IP addresses or names your DNS resolves.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`)
and an in-memory Technitium server (`test/helpers/fakeTechnitium.js`) built
from answers of a real server and the examples of `APIDOCS.md`
(`test/fixtures/technitium/`). See [`CLAUDE.md`](CLAUDE.md) for the project
rules.

## Credits

- [Technitium DNS Server](https://github.com/TechnitiumSoftware/DnsServer) by
  Shreyas Zare (GPL-3.0): its `APIDOCS.md`, whose examples shaped part of the
  test fixtures, and its source, read to understand the pause timer and the
  day statistics; no code was copied.
- [Pi-hole for Gladys](https://github.com/guim31/gladys-pihole): the
  architecture, the pause buttons and triggers, adapted here.
- [AdGuard Home for Gladys](https://github.com/cicoub13/gladys-adguard-home) by
  cicoub13 (Apache-2.0): the idea of the pause buttons; no code was copied.
- The conformity tests follow [gladys-wled](https://github.com/guim31/gladys-wled).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by Technitium.
"Technitium" is a name of its owner, used here only to say what the
integration works with.

## License

Apache-2.0
