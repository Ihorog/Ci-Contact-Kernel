# Orange seat widgetize (Product Canon v2.0)

## Intent
Replace Orange `cit-pwa` sidebar modules/dashboard/admin launcher with Ci intent→result surface.

## Apply on Orange (LAN/SSH)

```bash
set -euo pipefail
backup="/home/kazkar/cit/cit-pwa/index.html.bak-widgetize-$(date +%Y%m%d_%H%M%S)"
cp -a /home/kazkar/cit/cit-pwa/index.html "$backup"
python3 /home/kazkar/cit/bin/orange-widgetize.py
grep -q 'CI_WIDGETIZE_V1' /home/kazkar/cit/cit-pwa/index.html
! grep -q 'Модулі Cimeika' /home/kazkar/cit/cit-pwa/index.html
! grep -q 'Dashboard' /home/kazkar/cit/cit-pwa/index.html
! grep -q 'admin\.html' /home/kazkar/cit/cit-pwa/index.html
# optional: sudo -n /usr/bin/systemctl restart cimeika-orange-ui.service
curl -fsS http://127.0.0.1:8080/health
```

Copy `orange-widgetize.py` to `/home/kazkar/cit/bin/orange-widgetize.py` first (mode 0755).

## Dual-root
See `docs/orange/CI_ORANGE_DUAL_ROOT.md` — runtime `/home/kazkar/cit` vs registry `/home/kazkar/cimeika/cit`.

## Evidence after apply
- `index.html` contains `CI_WIDGETIZE_V1`
- Sidebar no longer lists Модулі Cimeika / Dashboard / external admin links
- Chat input remains as intent channel
