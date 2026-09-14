# Main branch protection evidence (`main`)

Last re-verified: 2026-09-14T13:46Z

## Target policy
- PR required before merge
- Required status check: `verify` (from `ci-plus-cloud`)
- Conversation resolution required before merge
- Force pushes blocked
- Branch deletion blocked
- Applies to administrators (no routine bypass actors)

## Live state from this agent run
1. `main` branch metadata is currently unprotected (`protected: false`).
2. `verify` check source is confirmed in `.github/workflows/ci-plus-cloud.yml` (`verify` job runs `npm ci`, `npm test`, and asset checks).
3. Latest observed `ci-plus-cloud` run on `main` is green:
   - Run ID: `34837544763`
   - Conclusion: `success`
   - URL: `https://github.com/Ihorog/Ci-Contact-Kernel/actions/runs/34837544763`
4. Direct repository-ruleset API access from this sandbox is blocked:
   - `GET https://api.github.com/repos/Ihorog/Ci-Contact-Kernel/rulesets` → `403` (`Blocked by DNS monitoring proxy`)

## External settings mutation still required
Apply one repository-level branch ruleset for `refs/heads/main` with active enforcement and no bypass actors.

### Example REST mutation to apply outside this sandbox
`POST /repos/Ihorog/Ci-Contact-Kernel/rulesets`

```json
{
  "name": "Protect main",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": {
    "ref_name": {
      "include": ["refs/heads/main"],
      "exclude": []
    }
  },
  "rules": [
    {
      "type": "pull_request",
      "parameters": {
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_approving_review_count": 0,
        "required_review_thread_resolution": true
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          {"context": "verify"}
        ]
      }
    },
    {"type": "non_fast-forward"},
    {"type": "deletion"}
  ]
}
```

## Post-apply re-verification checklist
- `main` reports protected in branch metadata.
- Ruleset appears as active for `main`.
- Required checks include `verify`.
- Conversation resolution is required.
- Force-push and deletion are blocked.
