# services/

Things that run as a process and serve traffic.

| Service | Team | Stack | Port |
|---|---|---|---|
| [`api/`](api/) | Backend | FastAPI, SQLAlchemy async, Postgres | 8000 |
| [`web/`](web/) | Frontend | React 19, TypeScript, Tailwind v4, Vite | 5173 |

They talk over one interface: [`../contracts/openapi.json`](../contracts/). Neither
imports the other's source. If you find yourself wanting to, the thing you want belongs
in the contract instead.

Each service owns its own dependency manifest, its own lockfile and its own Makefile, so
a change to the frontend's dependencies cannot break the backend's install — and CI only
runs the jobs whose paths a PR actually touched.
