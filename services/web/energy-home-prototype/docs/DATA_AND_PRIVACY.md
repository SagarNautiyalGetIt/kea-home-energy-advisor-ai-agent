# Data and privacy

## Summary

The prototype has no account system, backend, analytics, advertising SDK, or server-side database. It does not collect energy telemetry.

## Data flows

| Data                                           | Destination                   | Purpose                     | Persistence                                                   |
| ---------------------------------------------- | ----------------------------- | --------------------------- | ------------------------------------------------------------- |
| Search text                                    | Open-Meteo geocoding endpoint | Find towns and coordinates  | Not stored by this project                                    |
| Coordinates                                    | Open-Meteo forecast endpoint  | Fetch current weather       | Saved locally only when selected                              |
| Time zone and house bearing                    | Browser `localStorage`        | Restore display preferences | Current browser until cleared                                 |
| Example demand, battery, EV, and grid controls | In-memory React state         | Run the local simulation    | Ends with the session unless represented by saved preferences |

External providers may process requests under their own policies. Review their current terms before deploying the project for public traffic.

## What is not collected

- names, email addresses, or account identifiers;
- smart-meter, inverter, battery, or EV-charger telemetry;
- payment or billing information;
- analytics events, advertising identifiers, or cookies set by this project;
- API keys or authentication tokens.

## Location guidance

Coordinates can reveal a precise place. Use a town center or coarse location when sharing screenshots or demonstrations. Do not commit a private home address or exact residential coordinates.

## Clearing saved preferences

Remove the `kea-home-preferences` key from the browser's site data or clear local storage for the site.
