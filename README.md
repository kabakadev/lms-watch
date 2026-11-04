# lms-watch

## Active users

The dashboard displays the number of distinct signed-in browser sessions that
have made an authenticated request in the last five minutes. The value refreshes
every 30 seconds and is available from `GET /api/active-users` only to the
administrator account configured in `main.py`.

This is an in-memory application metric. It is reset when the Render service
restarts and is not shared between multiple instances. It counts authenticated
sessions only, so it cannot identify unauthenticated scans or a denial-of-service
attack against Render. It also intentionally does not expose IP addresses.
