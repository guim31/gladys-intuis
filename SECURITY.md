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

In scope: the code of this repository and the Docker image it publishes, in
particular how it handles the intuis Connect account:

- the e-mail and the password live in the Gladys configuration of the
  integration; the password is only sent to the intuis token endpoint
  (`/oauth2/token`, HTTPS), never written to `/data` nor to the logs;
- `/data/intuis-state.json` (owner-only mode) holds the access and refresh
  tokens intuis returns, a fingerprint of the account (a hash, not the e-mail),
  and the energy bookkeeping (which rooms report a consumption, up to when it
  was published);
- the container only talks to the intuis cloud over HTTPS
  (`app.muller-intuitiv.net`, `app-prod.intuis-sas.com`) and to Gladys; it
  opens no port.

A token, password or e-mail showing in a log line, an error message or a file
outside `/data` is a vulnerability: report it as above.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the intuis cloud and the radiators, and the public identifiers of the intuis
mobile app the integration signs in with (the same for every user, published
by the community projects).
