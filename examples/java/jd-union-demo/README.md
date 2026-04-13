# JD Union Java Demo

This is a standalone Java 17 example for calling the official JD Union API.

## Official notes

- Official router endpoint: `https://router.jd.com/api`
- Official keyword search API: `jd.union.open.goods.query`
- Official docs note that `access_token` is optional and "temporarily unsupported".
- Official docs also mark `jd.union.open.goods.query` as an advanced API that needs permission approval.

## Required environment variables

Use environment variables instead of hard-coding secrets:

```powershell
$env:JD_UNION_APP_KEY="your_app_key"
$env:JD_UNION_APP_SECRET="your_app_secret"
```

Optional:

```powershell
$env:JD_UNION_SITE_ID="your_site_id"
$env:JD_UNION_POSITION_ID="your_position_id"
```

If `JD_UNION_SITE_ID` is provided, the demo will also try to call
`jd.union.open.promotion.common.get` and generate a promotion link.

## Run

```powershell
mvn exec:java -Dexec.args="iPhone 16 Pro Max"
```

## Notes

- This example uses the official signing flow: sort params by ASCII, concatenate
  `secret + key/value pairs + secret`, then MD5 and uppercase.
- Response envelopes from JD Union often contain nested `*_response` wrappers and
  stringified `result` fields. The demo unwraps them generically.
- The exact product field names can differ by interface permission and account type,
  so the parser checks multiple candidate fields for price, coupon, and URL.
