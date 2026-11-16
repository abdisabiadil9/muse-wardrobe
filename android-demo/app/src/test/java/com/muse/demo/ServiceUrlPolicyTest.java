package com.muse.demo;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

public final class ServiceUrlPolicyTest {
    @Test
    public void acceptsHttpsAndNormalizesDefaultPorts() {
        ServiceUrlPolicy policy = ServiceUrlPolicy.parse(" HTTPS://Muse.Example.com:443/app?q=1 ");
        assertEquals("https://muse.example.com/app?q=1", policy.getUrl());
        assertEquals("https://muse.example.com", policy.getOrigin());
        assertEquals("https://example.com/", ServiceUrlPolicy.parse("https://example.com").getUrl());
        assertEquals("https://203.0.113.20/", ServiceUrlPolicy.parse("https://203.0.113.20").getUrl());
    }

    @Test
    public void acceptsRfc1918AndLoopbackHttp() {
        for (String host : new String[]{"10.0.0.1", "10.255.255.254", "172.16.0.1", "172.31.255.254",
                "192.168.1.20", "localhost", "127.0.0.1", "127.0.0.2", "[::1]"}) {
            ServiceUrlPolicy policy = ServiceUrlPolicy.parse("http://" + host + ":5179");
            assertTrue(policy.isSameOrigin("http://" + host + ":5179/api/v1/me"));
        }
    }

    @Test
    public void rejectsNonPrivateHttpAndAmbiguousAddresses() {
        for (String host : new String[]{"example.com", "muse.local", "8.8.8.8", "172.15.1.1", "172.32.0.1",
                "192.169.0.1", "100.83.225.53", "169.254.1.1", "0.0.0.0", "127.1", "2130706433",
                "127.000.000.001", "0x7f000001", "localhost.example.com", "localhost.", "[::]"}) {
            rejects("http://" + host + ":5179");
        }
    }

    @Test
    public void rejectsCredentialsFragmentsAndNonWebSchemes() {
        for (String value : new String[]{"https://user@example.com", "https://user:password@example.com",
                "https://example.com/#", "http://192.168.1.2/#screen", "javascript:alert(1)",
                "file:///sdcard/image.jpg", "content://media/external/images/1", "data:text/html,test",
                "intent://example.com", "//example.com", "example.com", "https:example.com", ""}) {
            rejects(value);
        }
    }

    @Test
    public void rejectsMalformedAuthoritiesAndControlCharacters() {
        for (String value : new String[]{"https://example.com:0", "https://example.com:65536",
                "https://example.com:", "https://example.com:-1", "https://example.com\\@evil.com",
                "https://example.com\n.evil.com", "https://example.com\t/path", "https://%65xample.com",
                "https://example..com", "https://-example.com", "https://example.com.", "https://999.1.1.1"}) {
            rejects(value);
        }
    }

    @Test
    public void sameOriginRequiresSchemeHostAndEffectivePort() {
        ServiceUrlPolicy policy = ServiceUrlPolicy.parse("https://muse.example.com/app");
        assertTrue(policy.isSameOrigin("https://MUSE.EXAMPLE.COM:443/api/v1/me"));
        assertTrue(policy.isSameOrigin("https://muse.example.com/app#wardrobe"));
        assertFalse(policy.isSameOrigin("http://muse.example.com/app"));
        assertFalse(policy.isSameOrigin("https://muse.example.com:5179/app"));
        assertFalse(policy.isSameOrigin("https://muse.example.com.evil.com/app"));
        assertFalse(policy.isSameOrigin("https://other.example.com/app"));
        assertFalse(policy.isSameOrigin("https://user@muse.example.com/app"));
        assertFalse(policy.isSameOrigin("javascript:alert(1)"));
        assertFalse(policy.isSameOrigin("content://muse.example.com/image"));
        assertTrue(ServiceUrlPolicy.parse("http://localhost:80").isSameOrigin("http://localhost/path"));
    }

    @Test
    public void externalLinksOnlyAllowSafeHttps() {
        assertTrue(ServiceUrlPolicy.isSafeExternalHttps("https://example.com/article#details"));
        assertFalse(ServiceUrlPolicy.isSafeExternalHttps("http://192.168.1.2"));
        assertFalse(ServiceUrlPolicy.isSafeExternalHttps("http://example.com"));
        assertFalse(ServiceUrlPolicy.isSafeExternalHttps("https://user@example.com"));
        assertFalse(ServiceUrlPolicy.isSafeExternalHttps("intent://example.com"));
        assertFalse(ServiceUrlPolicy.isSafeExternalHttps("file:///sdcard/a"));
        assertFalse(ServiceUrlPolicy.isSafeExternalHttps(null));
    }

    @Test
    public void permitsImageDataResourcesWithoutPermittingDataNavigation() {
        assertTrue(ServiceUrlPolicy.isImageDataResource("data:image/png;base64,iVBORw0KGgo="));
        assertTrue(ServiceUrlPolicy.isImageDataResource("data:image/svg+xml,%3Csvg%3E%3C/svg%3E"));
        assertFalse(ServiceUrlPolicy.isImageDataResource("data:text/html,<script>alert(1)</script>"));
        assertFalse(ServiceUrlPolicy.isImageDataResource("data:image/png"));
        assertFalse(ServiceUrlPolicy.isImageDataResource("content://media/1"));
        assertFalse(ServiceUrlPolicy.parse("https://example.com").isSameOrigin("data:image/png;base64,a"));
        rejects("data:image/png;base64,a");
    }

    private static void rejects(String address) {
        assertThrows(address, IllegalArgumentException.class, () -> ServiceUrlPolicy.parse(address));
    }
}
