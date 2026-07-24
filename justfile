# Options Dashboard task runner. Run `just` (or `just --list`) to see recipes.

# List available recipes.
default:
    @just --list

# Install all dependencies (Python via uv, web via npm).
install:
    cd fetcher && uv sync
    cd web && npm install

# Run the dashboard in dev mode with hot reload (http://localhost:5173).
dev:
    cd web && npm run dev

# Build the web app to web/dist/.
build:
    cd web && npm run build

# Serve the built app on http://localhost:4173.
serve:
    cd web && npm run preview

# Fetch the sheet once into web/dist/trades.json (reads config.toml at the project root).
fetch:
    cd fetcher && uv run python fetch_trades.py

# Run all tests (fetcher + web). Pass a pytest verbosity flag, e.g. `just test -q`.
test pytest_flag="-v":
    cd fetcher && uv run pytest {{pytest_flag}}
    cd web && npm test

# Lint everything without modifying files (style + bug patterns; no type-checking).
lint:
    cd fetcher && uv run ruff check .
    cd fetcher && uv run ruff format --check .
    cd web && npm run lint

# Auto-format and auto-fix everything.
fmt:
    cd fetcher && uv run ruff format .
    cd fetcher && uv run ruff check --fix .
    cd web && npm run format

# Type-check both sides (mypy strict + tsc strict).
typecheck:
    cd fetcher && uv run mypy normalize.py fetch_trades.py
    cd web && npm run typecheck

# Install git pre-commit hooks (requires pre-commit: `pipx install pre-commit`).
hooks:
    pre-commit install

# Full local gate: lint + typecheck + test (quiet pytest output).
check: lint typecheck (test "-q")
