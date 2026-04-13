package com.example.jdunion;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.math.BigDecimal;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.TreeMap;

public final class JdUnionKeywordSearchDemo {
    public static void main(String[] args) throws Exception {
        if (args.length == 0 || args[0].isBlank()) {
            System.err.println("Usage: mvn exec:java -Dexec.args=\"keyword\"");
            System.exit(1);
        }

        String appKey = requireEnv("JD_UNION_APP_KEY");
        String appSecret = requireEnv("JD_UNION_APP_SECRET");
        Long siteId = readLongEnv("JD_UNION_SITE_ID");
        Long positionId = readLongEnv("JD_UNION_POSITION_ID");

        JdUnionClient client = new JdUnionClient(appKey, appSecret);
        List<JdUnionProduct> products = client.searchGoodsByKeyword(args[0], 1, 10, siteId, positionId);

        if (products.isEmpty()) {
            System.out.println("No products returned.");
            return;
        }

        for (int i = 0; i < products.size(); i += 1) {
            JdUnionProduct product = products.get(i);
            System.out.println("[" + (i + 1) + "]");
            System.out.println("Name       : " + product.name());
            System.out.println("SKU        : " + product.skuId());
            System.out.println("Price      : " + nullSafe(product.price()));
            System.out.println("Coupon     : " + nullSafe(product.couponText()));
            System.out.println("Detail URL : " + nullSafe(product.detailUrl()));
            System.out.println("Promo URL  : " + nullSafe(product.promotionUrl()));
            System.out.println();
        }
    }

    private static String requireEnv(String key) {
        String value = System.getenv(key);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Missing environment variable: " + key);
        }
        return value;
    }

    private static Long readLongEnv(String key) {
        String value = System.getenv(key);
        if (value == null || value.isBlank()) {
            return null;
        }
        return Long.parseLong(value.trim());
    }

    private static String nullSafe(Object value) {
        return value == null ? "" : String.valueOf(value);
    }
}

final class JdUnionClient {
    private static final URI ROUTER_URI = URI.create("https://router.jd.com/api");
    private static final DateTimeFormatter TIMESTAMP_FORMATTER =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss", Locale.ROOT);

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final HttpClient httpClient = HttpClient.newHttpClient();
    private final String appKey;
    private final String appSecret;

    JdUnionClient(String appKey, String appSecret) {
        this.appKey = Objects.requireNonNull(appKey, "appKey");
        this.appSecret = Objects.requireNonNull(appSecret, "appSecret");
    }

    public List<JdUnionProduct> searchGoodsByKeyword(
            String keyword,
            int pageIndex,
            int pageSize,
            Long siteId,
            Long positionId
    ) throws IOException, InterruptedException {
        ObjectNode goodsReq = objectMapper.createObjectNode();
        goodsReq.put("keyword", keyword);
        goodsReq.put("pageIndex", pageIndex);
        goodsReq.put("pageSize", pageSize);

        ObjectNode paramJson = objectMapper.createObjectNode();
        paramJson.set("goodsReqDTO", goodsReq);

        JsonNode payload = callApi("jd.union.open.goods.query", paramJson);
        List<JsonNode> productNodes = findProductNodes(payload);
        List<JdUnionProduct> products = new ArrayList<>();

        for (JsonNode productNode : productNodes) {
            String skuId = firstText(productNode, "skuId", "wareId");
            String name = firstText(productNode, "goodsName", "skuName", "wareName");
            BigDecimal price = firstDecimal(
                    productNode.path("priceInfo").path("price"),
                    productNode.path("priceInfo").path("lowestPrice"),
                    productNode.path("unitPrice"),
                    productNode.path("price")
            );
            String couponText = buildCouponText(productNode);
            String detailUrl = firstText(
                    productNode,
                    "materialUrl",
                    "detailUrl",
                    "couponLink",
                    "url"
            );

            if (name == null || name.isBlank()) {
                continue;
            }

            String promotionUrl = null;
            if (detailUrl != null && !detailUrl.isBlank() && siteId != null) {
                try {
                    promotionUrl = buildPromotionUrl(detailUrl, siteId, positionId);
                } catch (Exception ignored) {
                    promotionUrl = null;
                }
            }

            products.add(new JdUnionProduct(skuId, name, price, couponText, detailUrl, promotionUrl));
        }

        products.sort(Comparator.comparing(JdUnionProduct::price, Comparator.nullsLast(BigDecimal::compareTo)));
        return products;
    }

    public String buildPromotionUrl(String materialId, long siteId, Long positionId)
            throws IOException, InterruptedException {
        ObjectNode promotionCodeReq = objectMapper.createObjectNode();
        promotionCodeReq.put("materialId", materialId);
        promotionCodeReq.put("siteId", siteId);
        if (positionId != null) {
            promotionCodeReq.put("positionId", positionId);
        }

        ObjectNode paramJson = objectMapper.createObjectNode();
        paramJson.set("promotionCodeReq", promotionCodeReq);

        JsonNode payload = callApi("jd.union.open.promotion.common.get", paramJson);
        return findFirstTextRecursively(payload, List.of(
                "shortURL",
                "clickURL",
                "longURL",
                "url"
        ));
    }

    private JsonNode callApi(String method, JsonNode paramJson)
            throws IOException, InterruptedException {
        String timestamp = ZonedDateTime.now(ZoneId.of("Asia/Shanghai")).format(TIMESTAMP_FORMATTER);

        Map<String, String> params = new TreeMap<>();
        params.put("app_key", appKey);
        params.put("format", "json");
        params.put("method", method);
        params.put("param_json", objectMapper.writeValueAsString(paramJson));
        params.put("sign_method", "md5");
        params.put("timestamp", timestamp);
        params.put("v", "1.0");

        String sign = sign(params, appSecret);
        params.put("sign", sign);

        String formBody = buildFormBody(params);
        HttpRequest request = HttpRequest.newBuilder(ROUTER_URI)
                .header("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
                .POST(HttpRequest.BodyPublishers.ofString(formBody, StandardCharsets.UTF_8))
                .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            throw new IOException("JD router HTTP error: " + response.statusCode() + " body=" + response.body());
        }

        JsonNode root = objectMapper.readTree(response.body());
        JsonNode responseEnvelope = unwrapResponseEnvelope(root);
        JsonNode businessPayload = unwrapBusinessPayload(responseEnvelope);

        int code = firstInt(
                businessPayload.path("code"),
                businessPayload.path("resultCode"),
                businessPayload.path("errorCode")
        ).orElse(0);
        if (code != 0 && code != 200) {
            throw new IOException("JD Union business error: " + businessPayload);
        }

        return businessPayload;
    }

    private JsonNode unwrapResponseEnvelope(JsonNode root) {
        if (root == null || root.isMissingNode()) {
            return objectMapper.createObjectNode();
        }

        if (!root.isObject()) {
            return root;
        }

        Iterator<Map.Entry<String, JsonNode>> fields = root.fields();
        while (fields.hasNext()) {
            Map.Entry<String, JsonNode> entry = fields.next();
            String key = entry.getKey();
            if (key.endsWith("_response") || key.endsWith("_responce")) {
                return entry.getValue();
            }
        }

        return root;
    }

    private JsonNode unwrapBusinessPayload(JsonNode envelope) throws IOException {
        JsonNode resultNode = envelope.path("result");
        if (resultNode.isTextual()) {
            return objectMapper.readTree(resultNode.asText());
        }
        if (!resultNode.isMissingNode() && !resultNode.isNull()) {
            return resultNode;
        }
        return envelope;
    }

    private List<JsonNode> findProductNodes(JsonNode payload) {
        List<JsonNode> candidates = new ArrayList<>();
        collectArrays(payload, candidates);

        List<JsonNode> products = new ArrayList<>();
        for (JsonNode candidate : candidates) {
            for (JsonNode item : candidate) {
                if (!item.isObject()) {
                    continue;
                }
                if (hasAnyField(item, "goodsName", "skuName", "wareName", "skuId", "priceInfo")) {
                    products.add(item);
                }
            }
        }
        return products;
    }

    private void collectArrays(JsonNode node, List<JsonNode> arrays) {
        if (node == null || node.isMissingNode() || node.isNull()) {
            return;
        }
        if (node.isArray()) {
            arrays.add(node);
            return;
        }
        if (node.isObject()) {
            node.elements().forEachRemaining(child -> collectArrays(child, arrays));
        }
    }

    private boolean hasAnyField(JsonNode node, String... fieldNames) {
        for (String fieldName : fieldNames) {
            if (!node.path(fieldName).isMissingNode() && !node.path(fieldName).isNull()) {
                return true;
            }
        }
        return false;
    }

    private String buildCouponText(JsonNode productNode) {
        JsonNode[] candidates = new JsonNode[] {
                productNode.path("couponInfo").path("couponList").path(0).path("discount"),
                productNode.path("couponInfo").path("couponList").path(0).path("couponPrice"),
                productNode.path("couponInfo").path("discount"),
                productNode.path("coupon").path("discount"),
                productNode.path("couponList").path(0).path("discount")
        };

        Optional<Integer> firstCouponValue = firstInt(candidates);
        if (firstCouponValue.isPresent()) {
            return firstCouponValue.get() + " off";
        }

        Optional<BigDecimal> firstCouponDecimal = firstDecimalOptional(candidates);
        return firstCouponDecimal.map(value -> value.stripTrailingZeros().toPlainString() + " off").orElse(null);
    }

    private static String sign(Map<String, String> params, String secret) {
        StringBuilder builder = new StringBuilder(secret);
        params.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .forEach(entry -> {
                    if (entry.getValue() == null) {
                        return;
                    }
                    builder.append(entry.getKey()).append(entry.getValue());
                });
        builder.append(secret);
        return md5Upper(builder.toString());
    }

    private static String md5Upper(String content) {
        try {
            MessageDigest md5 = MessageDigest.getInstance("MD5");
            byte[] digest = md5.digest(content.getBytes(StandardCharsets.UTF_8));
            StringBuilder builder = new StringBuilder(digest.length * 2);
            for (byte b : digest) {
                builder.append(String.format(Locale.ROOT, "%02X", b));
            }
            return builder.toString();
        } catch (Exception e) {
            throw new IllegalStateException("MD5 sign failed", e);
        }
    }

    private static String buildFormBody(Map<String, String> params) {
        List<String> parts = new ArrayList<>();
        for (Map.Entry<String, String> entry : params.entrySet()) {
            parts.add(urlEncode(entry.getKey()) + "=" + urlEncode(entry.getValue()));
        }
        return String.join("&", parts);
    }

    private static String urlEncode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private static String firstText(JsonNode node, String... fieldNames) {
        for (String fieldName : fieldNames) {
            JsonNode valueNode = node.path(fieldName);
            if (!valueNode.isMissingNode() && !valueNode.isNull()) {
                String value = valueNode.asText();
                if (!value.isBlank()) {
                    return value;
                }
            }
        }
        return null;
    }

    private static Optional<Integer> firstInt(JsonNode... nodes) {
        for (JsonNode node : nodes) {
            if (node == null || node.isMissingNode() || node.isNull()) {
                continue;
            }
            if (node.isInt() || node.isLong()) {
                return Optional.of(node.asInt());
            }
            if (node.isTextual()) {
                try {
                    return Optional.of(Integer.parseInt(node.asText().trim()));
                } catch (NumberFormatException ignored) {
                    // continue
                }
            }
        }
        return Optional.empty();
    }

    private static BigDecimal firstDecimal(JsonNode... nodes) {
        return firstDecimalOptional(nodes).orElse(null);
    }

    private static Optional<BigDecimal> firstDecimalOptional(JsonNode... nodes) {
        for (JsonNode node : nodes) {
            if (node == null || node.isMissingNode() || node.isNull()) {
                continue;
            }
            if (node.isNumber()) {
                return Optional.of(node.decimalValue());
            }
            if (node.isTextual()) {
                String raw = node.asText().trim();
                if (raw.isEmpty()) {
                    continue;
                }
                try {
                    return Optional.of(new BigDecimal(raw));
                } catch (NumberFormatException ignored) {
                    // continue
                }
            }
        }
        return Optional.empty();
    }

    private static String findFirstTextRecursively(JsonNode node, List<String> fieldNames) {
        if (node == null || node.isMissingNode() || node.isNull()) {
            return null;
        }
        if (node.isObject()) {
            for (String fieldName : fieldNames) {
                JsonNode candidate = node.path(fieldName);
                if (!candidate.isMissingNode() && !candidate.isNull() && candidate.isValueNode()) {
                    String text = candidate.asText();
                    if (!text.isBlank()) {
                        return text;
                    }
                }
            }
            Iterator<JsonNode> children = node.elements();
            while (children.hasNext()) {
                String nested = findFirstTextRecursively(children.next(), fieldNames);
                if (nested != null && !nested.isBlank()) {
                    return nested;
                }
            }
        } else if (node.isArray()) {
            for (JsonNode child : node) {
                String nested = findFirstTextRecursively(child, fieldNames);
                if (nested != null && !nested.isBlank()) {
                    return nested;
                }
            }
        }
        return null;
    }
}

record JdUnionProduct(
        String skuId,
        String name,
        BigDecimal price,
        String couponText,
        String detailUrl,
        String promotionUrl
) {
}
