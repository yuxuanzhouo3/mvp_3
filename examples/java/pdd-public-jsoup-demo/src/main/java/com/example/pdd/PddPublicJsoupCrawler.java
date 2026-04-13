package com.example.pdd;

import org.jsoup.Connection;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;

import java.io.IOException;
import java.math.BigDecimal;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Random;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class PddPublicJsoupCrawler {
    private static final String PDD_HOME = "https://mobile.yangkeduo.com/";
    private static final String SEARCH_URL = "https://mobile.yangkeduo.com/search_result.html?search_key=%s";
    private static final int REQUEST_INTERVAL_MS = 1500;
    private static final int TIMEOUT_MS = (int) Duration.ofSeconds(20).toMillis();
    private static final List<String> USER_AGENTS = List.of(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:135.0) Gecko/20100101 Firefox/135.0"
    );

    private final Random random = new Random();
    private long lastRequestAt = 0L;

    public static void main(String[] args) throws Exception {
        if (args.length == 0 || args[0].isBlank()) {
            System.err.println("Usage: mvn exec:java -Dexec.args=\"keyword\"");
            System.exit(1);
        }

        PddPublicJsoupCrawler crawler = new PddPublicJsoupCrawler();

        try {
            List<PddProduct> products = crawler.fetchProductsByKeyword(args[0], 3);
            if (products.isEmpty()) {
                System.out.println("No products parsed from the public page.");
                return;
            }

            for (int i = 0; i < products.size(); i += 1) {
                PddProduct product = products.get(i);
                System.out.println("[" + (i + 1) + "]");
                System.out.println("Title : " + product.title());
                System.out.println("Price : " + formatPrice(product.price()));
                System.out.println("Link  : " + product.link());
                System.out.println();
            }
        } catch (PddBlockedException blocked) {
            System.err.println("PDD anonymous public search is currently blocked.");
            System.err.println(blocked.getMessage());
        }
    }

    public List<PddProduct> fetchProductsByKeyword(String keyword, int limit) throws IOException {
        String searchUrl = SEARCH_URL.formatted(urlEncode(keyword));
        PageResponse response = getPage(searchUrl, PDD_HOME);

        if (isBlocked(response)) {
            throw new PddBlockedException("Blocked or redirected: " + response.finalUrl());
        }

        List<PddProduct> products = parseSearchResults(response.document(), response.finalUrl(), limit);
        if (!products.isEmpty()) {
            return products;
        }

        if (looksLikePublicShell(response.document())) {
            throw new PddBlockedException("Public shell page returned without parsable goods cards.");
        }

        return products;
    }

    public Optional<PddProduct> fetchProductDetail(String goodsUrl) throws IOException {
        PageResponse response = getPage(goodsUrl, PDD_HOME);

        if (isBlocked(response)) {
            return Optional.empty();
        }

        return Optional.ofNullable(parseDetailPage(response.document(), response.finalUrl()));
    }

    private List<PddProduct> parseSearchResults(Document document, String baseUrl, int limit) {
        Elements anchors = document.select("a[href*=goods_id=], a[href*=goods.html]");
        List<PddProduct> products = new ArrayList<>();
        Set<String> seenLinks = new LinkedHashSet<>();

        for (Element anchor : anchors) {
            try {
                String link = toAbsoluteUrl(anchor.attr("href"), baseUrl);
                if (link == null || !seenLinks.add(link)) {
                    continue;
                }

                Element card = findCardContainer(anchor);
                String cardText = normalizeWhitespace(card != null ? card.text() : anchor.text());
                String title = firstNonBlank(
                        normalizeWhitespace(anchor.attr("title")),
                        normalizeWhitespace(anchor.selectFirst("img") != null ? anchor.selectFirst("img").attr("alt") : ""),
                        normalizeWhitespace(beforePrice(cardText))
                );
                BigDecimal price = parsePrice(cardText);

                if (title == null || title.isBlank() || price == null) {
                    continue;
                }

                products.add(new PddProduct(title, price, link));
                if (products.size() >= limit) {
                    break;
                }
            } catch (Exception ignored) {
                // Single-card parse failures should not stop the full crawl.
            }
        }

        return products;
    }

    private PddProduct parseDetailPage(Document document, String finalUrl) {
        String html = document.outerHtml();
        String pageText = normalizeWhitespace(document.body() != null ? document.body().text() : "");
        String title = firstNonBlank(
                attr(document, "meta[property=og:title]", "content"),
                text(document, "h1"),
                normalizeWhitespace(document.title()),
                findFirstRegex(html,
                        "\"goods_name\"\\s*:\\s*\"([^\"]+)\"",
                        "\"goodsName\"\\s*:\\s*\"([^\"]+)\"")
        );
        BigDecimal price = firstNonNull(
                parsePrice(attr(document, "meta[property='product:price:amount']", "content")),
                parsePrice(attr(document, "meta[property='og:description']", "content")),
                parsePrice(findFirstRegex(html,
                        "\"min_group_price\"\\s*:\\s*(\\d+)",
                        "\"minGroupPrice\"\\s*:\\s*(\\d+)",
                        "\"price\"\\s*:\\s*\"?(\\d+(?:\\.\\d+)?)\"?")),
                parsePrice(pageText)
        );

        if (price != null && isCentPrice(html)) {
            price = price.movePointLeft(2);
        }

        if (title == null || title.isBlank() || price == null) {
            return null;
        }

        return new PddProduct(title, price, finalUrl);
    }

    private boolean isBlocked(PageResponse response) {
        String finalUrl = response.finalUrl().toLowerCase(Locale.ROOT);
        String html = response.document().outerHtml();
        String title = normalizeWhitespace(response.document().title());

        return finalUrl.contains("/login.html")
                || title.toLowerCase(Locale.ROOT).contains("login")
                || html.contains("proxy/api/search?pdduid=0")
                || html.contains("search_result_")
                || html.toLowerCase(Locale.ROOT).contains("login.html");
    }

    private boolean looksLikePublicShell(Document document) {
        String html = document.outerHtml();
        return html.contains("search_result_") && document.select("a[href*=goods_id=], a[href*=goods.html]").isEmpty();
    }

    private PageResponse getPage(String url, String referer) throws IOException {
        waitForInterval();

        Connection connection = Jsoup.connect(url)
                .ignoreContentType(true)
                .followRedirects(true)
                .timeout(TIMEOUT_MS)
                .maxBodySize(0)
                .userAgent(randomUserAgent())
                .referrer(referer)
                .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8")
                .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
                .header("Cache-Control", "no-cache")
                .header("Pragma", "no-cache")
                .header("Upgrade-Insecure-Requests", "1")
                .header("Sec-Fetch-Dest", "document")
                .header("Sec-Fetch-Mode", "navigate")
                .header("Sec-Fetch-Site", "same-origin");

        Connection.Response response = connection.execute();
        Document document = response.parse();
        lastRequestAt = System.currentTimeMillis();
        return new PageResponse(document, response.url().toString(), response.statusCode());
    }

    private void waitForInterval() {
        long now = System.currentTimeMillis();
        long wait = REQUEST_INTERVAL_MS - (now - lastRequestAt);
        if (wait <= 0) {
            return;
        }

        try {
            Thread.sleep(wait);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Sleep interrupted", e);
        }
    }

    private String randomUserAgent() {
        return USER_AGENTS.get(random.nextInt(USER_AGENTS.size()));
    }

    private Element findCardContainer(Element anchor) {
        Element current = anchor;
        for (int i = 0; i < 6 && current != null; i += 1) {
            if (normalizeWhitespace(current.text()).length() >= 12) {
                return current;
            }
            current = current.parent();
        }
        return anchor.parent();
    }

    private static String beforePrice(String text) {
        if (text == null) {
            return "";
        }
        Matcher matcher = Pattern.compile("\\d[\\d,]*\\.?\\d{0,2}").matcher(text);
        return matcher.find() ? text.substring(0, matcher.start()) : text;
    }

    private static String toAbsoluteUrl(String input, String baseUrl) {
        if (input == null || input.isBlank()) {
            return null;
        }
        if (input.startsWith("http://") || input.startsWith("https://")) {
            return input;
        }
        if (input.startsWith("//")) {
            return "https:" + input;
        }
        if (input.startsWith("/")) {
            return "https://mobile.yangkeduo.com" + input;
        }
        if (baseUrl != null && !baseUrl.isBlank() && baseUrl.endsWith("/")) {
            return baseUrl + input;
        }
        return input;
    }

    private static String normalizeWhitespace(String value) {
        return value == null ? "" : value.replaceAll("\\s+", " ").trim();
    }

    private static String firstNonBlank(String... values) {
        for (String value : values) {
            if (value != null && !value.isBlank()) {
                return value;
            }
        }
        return null;
    }

    @SafeVarargs
    private static <T> T firstNonNull(T... values) {
        for (T value : values) {
            if (value != null) {
                return value;
            }
        }
        return null;
    }

    private static String attr(Document document, String cssQuery, String attrName) {
        Element element = document.selectFirst(cssQuery);
        return element == null ? null : normalizeWhitespace(element.attr(attrName));
    }

    private static String text(Document document, String cssQuery) {
        Element element = document.selectFirst(cssQuery);
        return element == null ? null : normalizeWhitespace(element.text());
    }

    private static BigDecimal parsePrice(String text) {
        if (text == null || text.isBlank()) {
            return null;
        }

        Matcher matcher = Pattern.compile("(\\d[\\d,]*\\.?\\d{0,2})").matcher(text);
        if (!matcher.find()) {
            return null;
        }

        try {
            return new BigDecimal(matcher.group(1).replace(",", ""));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static String findFirstRegex(String source, String... regexes) {
        if (source == null || source.isBlank()) {
            return null;
        }
        for (String regex : regexes) {
            Matcher matcher = Pattern.compile(regex).matcher(source);
            if (matcher.find()) {
                return normalizeWhitespace(matcher.group(1));
            }
        }
        return null;
    }

    private static boolean isCentPrice(String html) {
        return html != null && (html.contains("min_group_price") || html.contains("minGroupPrice"));
    }

    private static String urlEncode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}

record PddProduct(String title, BigDecimal price, String link) {
}

record PageResponse(Document document, String finalUrl, int statusCode) {
}

final class PddBlockedException extends IOException {
    PddBlockedException(String message) {
        super(message);
    }
}
