# Main branch protection evidence (`main`)

Last re-verified: 2026-09-14T14:40Z

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

## Verification status against target policy
- `main` protection active: ✅ verified (`protected: true`).
- Required status check source (`verify` from `ci-plus-cloud`): ✅ verified.
- PR-only merge enforcement: ⏳ not directly readable from this runtime.
- Required conversation resolution: ⏳ not directly readable from this runtime.
- Force-push blocked: ⏳ not directly readable from this runtime.
- Branch deletion blocked: ⏳ not directly readable from this runtime.
- Applies to administrators (no routine bypass): ⏳ not directly readable from this runtime.

## Exact remaining mismatch
The remaining mismatch is verification visibility, not branch content: this agent runtime cannot read repository ruleset details (`/rulesets` API returns 403 via DNS proxy), so the policy fields that are only visible in repository settings could not be directly re-verified from this environment.
