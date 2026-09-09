#!/usr/bin/env python3
import json
import sys
sys.path.insert(0, '/home/kazkar/cit/modules/ci_operator')
import ci_operator

checks = {
    'status': ci_operator.status(),
    'resolve_github': ci_operator.resolve('перевір репозиторій GitHub'),
    'resolve_sharepoint': ci_operator.resolve('перевір SharePoint'),
    'dispatch_link': ci_operator.dispatch(
        'Ci Operator transport verification; record contact only, no external write.',
        'CI.LINK',
        'contact',
    ),
}
print(json.dumps(checks, ensure_ascii=False, indent=2))

ok = (
    checks['status'].get('ok') is True
    and checks['status'].get('registry', {}).get('connections') == 28
    and checks['resolve_github'].get('coordinate') == 'CI.GITHUB'
    and checks['resolve_sharepoint'].get('state') == 'BLOCKED'
    and checks['dispatch_link'].get('ok') is True
    and checks['dispatch_link'].get('executed') is True
)
print('CI_OPERATOR_SELFTEST=' + ('PASS' if ok else 'FAIL'))
raise SystemExit(0 if ok else 1)
