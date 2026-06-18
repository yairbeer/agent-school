# Contributing to AgentSchool

Thanks for your interest in contributing! 🎉

## Ways to contribute

- 🐛 Report bugs via [issues](../../issues).
- 💡 Propose features or discuss the spec in [`PRD.md`](./PRD.md).
- 🔧 Submit pull requests.

## Development workflow

1. Fork and clone the repo.
2. Create a feature branch: `git checkout -b feat/my-change`.
3. Make your changes with clear, focused commits.
4. Ensure lint/tests pass (once tooling is in place).
5. Open a pull request describing **what** and **why**.

## Commit messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add session loader
fix: tolerate malformed JSONL lines
docs: clarify backup behavior
```

## Privacy note

Pi sessions can contain secrets and private code. **Never commit real session
files, `.env` files, or `AGENTS.md` backups.** Use redacted/synthetic samples
for tests and examples.

## Code of Conduct

By participating, you agree to abide by our
[Code of Conduct](./CODE_OF_CONDUCT.md).
