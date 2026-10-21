# 🤝 Contributing to Open Semrush

Thank you for your interest in contributing to **Open Semrush**! We welcome bug reports, documentation enhancements, feature proposals, and architectural improvements.

---

## 🛠️ Development Setup

### Prerequisites

- **Node.js**: `v22.0.0` or higher
- **npm**: `v10.0.0` or higher
- **Docker & Docker Compose** *(optional, for containerized testing)*

### Installation

```bash
# Clone the repository
git clone https://github.com/mightyalok00/open-semrush.git
cd open-semrush

# Copy environment variables
cp .env.example .env

# Install locked dependencies
npm install

# Compile TypeScript
npm run build

# Start local development server
npm start
```

The web studio interface will be available at `<http://localhost:3000>`.

---

## 🧪 Testing Guidelines

Before submitting a pull request, ensure all tests, coverage gates, and security scanners pass cleanly:

```bash
# 1. Run full 83-test verification suite
npm test

# 2. Run test coverage (enforces 72% minimum coverage gate)
npm run test:coverage

# 3. Run dedicated SSRF, redirect, and auth security regressions
npm run check:security

# 4. Verify no committed credentials or private keys
npm run check:secrets

# 5. Typecheck TypeScript source
npx tsc --noEmit
```

### Writing Tests

- Name test files with the pattern `tests/*.test.mjs`.
- Use Node.js native test runner (`node:test` and `node:assert/strict`).
- Avoid network mocks for local algorithms; assert mathematical bounds, non-negative values, and edge cases.

---

## 📝 Commit & Pull Request Conventions

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

- `feat(scope)`: New features or algorithmic capabilities
- `fix(scope)`: Bug fixes or boundary condition corrections
- `docs(scope)`: Documentation, README, or whitepaper updates
- `test(scope)`: New automated test cases or benchmark scenarios
- `refactor(scope)`: Code refactoring without behavioral modifications
- `perf(scope)`: Performance optimizations

### PR Checklist

- [ ] All 83+ tests pass (`npm test`).
- [ ] No secrets or private tokens in `.env` or source files (`npm run check:secrets`).
- [ ] Added test coverage for any new behavior or bug fix.
- [ ] Markdown documentation adheres to `markdownlint` standards (no inline HTML, single-space table pipes).

---

## 📄 License

By contributing to Open Semrush, you agree that your contributions will be licensed under the project's [MIT License](LICENSE).
