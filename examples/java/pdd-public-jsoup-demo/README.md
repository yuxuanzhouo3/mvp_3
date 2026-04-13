# PDD Public Jsoup Demo

This is a standalone Java 17 example that uses `Jsoup` to fetch publicly accessible
Pinduoduo pages without login, cookies, or any open-platform account.

## What it does

- Uses only public page URLs.
- Sends normal browser-like headers.
- Rotates several common User-Agent strings.
- Adds a fixed request interval.
- Tries keyword search first.
- Falls back to parsing known product detail URLs.
- Detects when the anonymous request is blocked or redirected to login.

## Important limitation

This example does **not** bypass login walls, CAPTCHAs, or stronger anti-bot checks.
If Pinduoduo returns a public shell page, a 403-backed search bootstrap, or a login
redirect, the code will report that honestly and stop.

In practice, direct product detail pages are often more reliable than anonymous keyword
search pages.

## Run

```powershell
cd examples\java\pdd-public-jsoup-demo
mvn exec:java -Dexec.args="iPhone 16 Pro Max"
```

## Direct detail-page mode

If you already have public product links, you can edit `main()` and call:

```java
crawler.fetchProductDetail("https://mobile.yangkeduo.com/goods.html?goods_id=123456789");
```
