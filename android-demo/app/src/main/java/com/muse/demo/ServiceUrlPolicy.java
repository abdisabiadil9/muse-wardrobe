package com.muse.demo;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

/** Pure Java URL policy: never resolves DNS or makes a network request. */
public final class ServiceUrlPolicy {
    private final WebUrl service;

    private ServiceUrlPolicy(WebUrl service) {
        this.service = service;
    }

    public static ServiceUrlPolicy parse(String address) {
        WebUrl parsed = parseWebUrl(address, false);
        if (!parsed.scheme.equals("https") && !isLocalHttpHost(parsed.host)) {
            throw new IllegalArgumentException("HTTP requires a private or loopback address");
        }
        return new ServiceUrlPolicy(parsed);
    }

    public String getUrl() {
        return service.url;
    }

    public String getOrigin() {
        return service.origin;
    }

    public boolean isSameOrigin(String url) {
        try {
            return service.origin.equals(parseWebUrl(url, true).origin);
        } catch (IllegalArgumentException ignored) {
            return false;
        }
    }

    public static boolean isSafeExternalHttps(String url) {
        try {
            return parseWebUrl(url, true).scheme.equals("https");
        } catch (IllegalArgumentException ignored) {
            return false;
        }
    }

    private static WebUrl parseWebUrl(String input, boolean allowFragment) {
        if (input == null) throw new IllegalArgumentException("Missing URL");
        String value = input.trim();
        if (value.isEmpty() || value.length() > 4096 || value.indexOf('\\') >= 0) {
            throw new IllegalArgumentException("Invalid URL");
        }
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (Character.isWhitespace(c) || Character.isISOControl(c)) {
                throw new IllegalArgumentException("Whitespace in URL");
            }
        }
        try {
            URI uri = new URI(value);
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            if ((!scheme.equals("http") && !scheme.equals("https")) || uri.isOpaque()
                    || uri.getRawUserInfo() != null || (!allowFragment && uri.getRawFragment() != null)) {
                throw new IllegalArgumentException("Unsupported URL");
            }
            String host = uri.getHost();
            String authority = uri.getRawAuthority();
            if (host == null || authority == null || authority.endsWith(":")) {
                throw new IllegalArgumentException("Missing host");
            }
            host = host.toLowerCase(Locale.ROOT);
            if (host.startsWith("[") && host.endsWith("]")) host = host.substring(1, host.length() - 1);
            if (!isHost(host)) throw new IllegalArgumentException("Invalid host");
            int port = uri.getPort();
            if (port == 0 || port < -1 || port > 65535) throw new IllegalArgumentException("Invalid port");
            int defaultPort = scheme.equals("https") ? 443 : 80;
            String origin = scheme + "://" + (host.contains(":") ? "[" + host + "]" : host)
                    + (port == -1 || port == defaultPort ? "" : ":" + port);
            String path = uri.getRawPath();
            String url = origin + (path == null || path.isEmpty() ? "/" : path)
                    + (uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery())
                    + (uri.getRawFragment() == null ? "" : "#" + uri.getRawFragment());
            return new WebUrl(scheme, host, origin, url);
        } catch (URISyntaxException error) {
            throw new IllegalArgumentException("Invalid URL", error);
        }
    }

    private static boolean isHost(String host) {
        if (host.equals("::1")) return true;
        if (host.isEmpty() || host.length() > 253 || host.endsWith(".") || host.contains(":")) return false;
        if (host.matches("[0-9.]+")) return ipv4(host) != null;
        // Numeric final labels can be interpreted as non-canonical IP addresses by browsers.
        String[] labels = host.split("\\.", -1);
        if (labels[labels.length - 1].matches("[0-9]+")) return false;
        for (String label : labels) {
            if (!label.matches("[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?")) return false;
        }
        return true;
    }

    private static boolean isLocalHttpHost(String host) {
        if (host.equals("localhost") || host.equals("::1")) return true;
        int[] ip = ipv4(host);
        return ip != null && (ip[0] == 10 || ip[0] == 127
                || (ip[0] == 172 && ip[1] >= 16 && ip[1] <= 31)
                || (ip[0] == 192 && ip[1] == 168));
    }

    private static int[] ipv4(String host) {
        String[] parts = host.split("\\.", -1);
        if (parts.length != 4) return null;
        int[] values = new int[4];
        for (int i = 0; i < parts.length; i++) {
            if (!parts[i].matches("0|[1-9][0-9]{0,2}")) return null;
            values[i] = Integer.parseInt(parts[i]);
            if (values[i] > 255) return null;
        }
        return values;
    }

    private static final class WebUrl {
        final String scheme;
        final String host;
        final String origin;
        final String url;

        WebUrl(String scheme, String host, String origin, String url) {
            this.scheme = scheme;
            this.host = host;
            this.origin = origin;
            this.url = url;
        }
    }
}
