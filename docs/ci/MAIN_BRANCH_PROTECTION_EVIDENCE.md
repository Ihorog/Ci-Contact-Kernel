# Main branch protection evidence (`main`)

Last re-verified: 2026-09-14T15:33Z

## Target policy
- PR required before merge
- Required status check: `verify` (from `ci-plus-cloud`)
- Conversation resolution required before merge
- Force pushes blocked
- Branch deletion blocked
- Applies to administrators (no routine bypass actors)

## Live state from this agent run
1. `main` branch metadata now reports protected (`protected: true`).
2. `verify` check source is confirmed in `.github/workflows/ci-plus-cloud.yml` (`verify` job runs `npm ci`, `npm test`, and asset checks).
3. Latest observed `ci-plus-cloud` run on `main` is green:
   - Run ID: `34856820995`
   - Conclusion: `success`
   - URL: `https://github.com/Ihorog/Ci-Contact-Kernel/actions/runs/34856820995`
4. Direct repository-ruleset API read from this sandbox remains blocked:
   - `GET https://api.github.com/repos/Ihorog/Ci-Contact-Kernel/rulesets` → `403` (`Blocked by DNS monitoring proxy`)

## Externally verified live settings (authorized executor)
- required status check includes `verify` with `strict=true`
- PR requirement present
- conversation resolution `true`
- `enforce_admins=true`
- `allow_force_pushes=false`
- `allow_deletions=false`

## Verification status against target policy
- `main` protection active: ✅ verified (`protected: true`).
- Required status check source (`verify` from `ci-plus-cloud`): ✅ verified.
- PR-only merge enforcement: ✅ verified (external authorized executor evidence).
- Required conversation resolution: ✅ verified (external authorized executor evidence).
- Force-push blocked: ✅ verified (external authorized executor evidence).
- Branch deletion blocked: ✅ verified (external authorized executor evidence).
- Applies to administrators (no routine bypass): ✅ verified (external authorized executor evidence).
