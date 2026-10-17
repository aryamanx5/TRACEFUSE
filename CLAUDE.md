# TRACEFUSE — project instructions

- Backend: `backend/` (Python 3.14 venv at `backend/.venv`, FastAPI, SQLite). Frontend: `frontend/` (React+Vite+TS).
- Source of truth for progress: `docs/BUILD_STATUS.md` — read it first, update it after every unit of work.
- Never fake data or success. Missing credentials = "unconfigured", not mocked. Historical data only via the
  labelled Ronin case cassette (`backend/data/cases/ronin-2022/`), replayed through the same adapters.
- Never call a heuristic score a probability; never attribute identity automatically.
- Secrets stay server-side; never log, export or commit keys.
- Commands: `cd backend && .venv/bin/pytest -q`, `.venv/bin/ruff check tracefuse tests`, `.venv/bin/mypy tracefuse`;
  `cd frontend && npm run build && npm test`.
