# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- One Gladys device per Technitium DNS Server (up to three), read over the
  local network with an API token: the blocking switch (a pause of 5 to 60
  minutes, or off until turned back on), the DNS queries of the last hour and
  of the last day, the blocked queries and their share, the clients, the zones,
  the blocked domains, update available, the version, and the DHCP leases when
  a DHCP scope is enabled.
- Dashboard widget "Technitium DNS": the day's figures, the state of each
  server, and Pause 5 min, Pause 30 min, Pause… (Gladys 5.2.0) and Resume
  buttons.
- Scene triggers: blocking paused, blocking resumed, update available, server
  no longer answers, server answers again.
- Scene actions: pause the blocking for a number of minutes, resume it, flush
  the DNS cache, read the statistics into a sentence.
- A "Test the connection" button, and a connection status that names the
  server and the problem.
- Every text in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-technitium/commits/main
