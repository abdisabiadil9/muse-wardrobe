package com.muse.demo;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import java.io.ByteArrayInputStream;
import java.util.Collections;

public final class MainActivity extends Activity {
    private static final int PICK_IMAGE = 40;
    private static final int BACKGROUND = 0xFFFFFFFF;
    private static final int INK = 0xFF1C1C1E;
    private static final String PREFS = "muse_demo";
    private static final String SERVICE_URL = "service_url";

    private SharedPreferences preferences;
    private volatile ServiceUrlPolicy service;
    private LinearLayout root;
    private FrameLayout content;
    private TextView toolbarTitle;
    private TextView loading;
    private WebView webView;
    private View overlay;
    private boolean editingAddress;
    private boolean pageFailed;
    private boolean destroyed;
    private ValueCallback<Uri[]> fileCallback;
    private OnBackInvokedCallback backCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        buildLayout();
        if (Build.VERSION.SDK_INT >= 33) {
            backCallback = this::handleBack;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
        }
        String saved = preferences.getString(SERVICE_URL, "");
        try {
            service = ServiceUrlPolicy.parse(saved);
            loadService();
        } catch (IllegalArgumentException ignored) {
            showAddressEditor();
        }
    }

    private void buildLayout() {
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BACKGROUND);
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        int appearance = View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        if (Build.VERSION.SDK_INT >= 26) appearance |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        getWindow().getDecorView().setSystemUiVisibility(appearance);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets edges = insets.getInsets(WindowInsets.Type.systemBars()
                        | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(edges.left, edges.top, edges.right, edges.bottom);
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                        insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });

        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(4), 0, dp(4), 0);
        Button back = button(R.string.back);
        back.setOnClickListener(view -> handleBack());
        toolbar.addView(back, new LinearLayout.LayoutParams(dp(68), dp(48)));
        toolbarTitle = text(R.string.app_name, 16);
        toolbarTitle.setSingleLine(true);
        toolbarTitle.setEllipsize(TextUtils.TruncateAt.END);
        toolbar.addView(toolbarTitle, new LinearLayout.LayoutParams(0, dp(48), 1));
        toolbarTitle.setGravity(Gravity.CENTER_VERTICAL);
        Button address = button(R.string.change_address);
        address.setOnClickListener(view -> showAddressEditor());
        toolbar.addView(address, new LinearLayout.LayoutParams(dp(84), dp(48)));
        root.addView(toolbar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));
        View divider = new View(this);
        divider.setBackgroundColor(0xFFF2F2F7);
        root.addView(divider, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)));
        content = new FrameLayout(this);
        root.addView(content, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(root);
        root.requestApplyInsets();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private boolean ensureWebView() {
        if (webView != null) return true;
        try {
            webView = new WebView(this);
        } catch (RuntimeException unavailable) {
            showFailure(R.string.webview_unavailable);
            return false;
        }
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        // Required for a user-selected ACTION_OPEN_DOCUMENT image; no file access or JS bridge.
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setGeolocationEnabled(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        if (Build.VERSION.SDK_INT >= 26) settings.setSafeBrowsingEnabled(true);
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        webView.setBackgroundColor(BACKGROUND);
        webView.setWebViewClient(new BrowserClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                    FileChooserParams params) {
                cancelFileChoice();
                if (destroyed || editingAddress || params.getMode() != FileChooserParams.MODE_OPEN) {
                    callback.onReceiveValue(null);
                    toast(R.string.image_only);
                    return true;
                }
                fileCallback = callback;
                Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                picker.addCategory(Intent.CATEGORY_OPENABLE);
                picker.setType("image/*");
                picker.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false);
                picker.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try {
                    startActivityForResult(Intent.createChooser(picker, getString(R.string.choose_image)), PICK_IMAGE);
                } catch (ActivityNotFoundException unavailable) {
                    cancelFileChoice();
                    toast(R.string.file_picker_unavailable);
                }
                return true;
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.deny();
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                callback.invoke(origin, false, false);
            }
        });
        content.addView(webView, 0, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        return true;
    }

    private void loadService() {
        if (service == null || destroyed) return;
        editingAddress = false;
        cancelFileChoice();
        clearOverlay();
        toolbarTitle.setText(service.getOrigin());
        if (!ensureWebView()) return;
        pageFailed = false;
        webView.setVisibility(View.VISIBLE);
        loading = text(R.string.loading, 16);
        loading.setGravity(Gravity.CENTER);
        loading.setBackgroundColor(BACKGROUND);
        content.addView(loading, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        webView.loadUrl(service.getUrl());
    }

    private void showAddressEditor() {
        if (destroyed) return;
        cancelFileChoice();
        editingAddress = true;
        if (webView != null) {
            webView.stopLoading();
            webView.setVisibility(View.GONE);
        }
        clearOverlay();
        toolbarTitle.setText(R.string.app_name);
        ScrollView scroll = new ScrollView(this);
        LinearLayout form = panel();
        form.addView(text(R.string.address_title, 24));
        addSpace(form, 16);
        form.addView(text(R.string.address_help, 16));
        addSpace(form, 20);
        EditText input = new EditText(this);
        input.setHint(R.string.address_hint);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setSingleLine(true);
        input.setTextSize(16);
        input.setText(service == null ? "" : service.getUrl());
        input.setSelectAllOnFocus(true);
        if (Build.VERSION.SDK_INT >= 26) input.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
        form.addView(input, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(56)));
        addSpace(form, 8);
        form.addView(text(R.string.address_rules, 14));
        addSpace(form, 20);
        Button connect = button(R.string.connect);
        connect.setOnClickListener(view -> {
            try {
                ServiceUrlPolicy next = ServiceUrlPolicy.parse(input.getText().toString());
                if (service == null || !service.getOrigin().equals(next.getOrigin())) destroyWebView();
                service = next;
                preferences.edit().putString(SERVICE_URL, next.getUrl()).apply();
                InputMethodManager keyboard = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
                if (keyboard != null) keyboard.hideSoftInputFromWindow(input.getWindowToken(), 0);
                // Different origins receive a fresh WebView; same-origin path edits clear old history.
                if (webView != null) webView.clearHistory();
                loadService();
            } catch (IllegalArgumentException invalid) {
                input.setError(getString(R.string.invalid_address));
            }
        });
        form.addView(connect, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));
        scroll.addView(form);
        overlay = scroll;
        content.addView(overlay, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void showFailure(int message) {
        if (destroyed || editingAddress) return;
        pageFailed = true;
        if (webView != null) {
            webView.stopLoading();
            webView.setVisibility(View.GONE);
        }
        clearOverlay();
        LinearLayout panel = panel();
        panel.setGravity(Gravity.CENTER_VERTICAL);
        panel.addView(text(R.string.network_title, 24));
        addSpace(panel, 16);
        panel.addView(text(message, 16));
        addSpace(panel, 24);
        Button retry = button(R.string.retry);
        retry.setOnClickListener(view -> loadService());
        panel.addView(retry, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));
        Button address = button(R.string.change_address);
        address.setOnClickListener(view -> showAddressEditor());
        panel.addView(address, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));
        overlay = panel;
        content.addView(overlay, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void clearOverlay() {
        if (overlay != null) content.removeView(overlay);
        if (loading != null) content.removeView(loading);
        overlay = null;
        loading = null;
    }

    private boolean handleNavigation(String url, boolean mainFrame, boolean userGesture) {
        ServiceUrlPolicy current = service;
        if (current != null && current.isSameOrigin(url)) return false;
        if (mainFrame && userGesture && ServiceUrlPolicy.isSafeExternalHttps(url)) {
            Intent external = new Intent(Intent.ACTION_VIEW, Uri.parse(url.trim()));
            external.addCategory(Intent.CATEGORY_BROWSABLE);
            try {
                startActivity(external);
            } catch (ActivityNotFoundException unavailable) {
                toast(R.string.no_browser);
            }
        } else if (mainFrame) {
            toast(R.string.navigation_blocked);
        }
        return true;
    }

    private final class BrowserClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return handleNavigation(request.getUrl().toString(), request.isForMainFrame(), request.hasGesture());
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return handleNavigation(url, true, false);
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            String url = request.getUrl().toString();
            ServiceUrlPolicy current = service;
            if (current != null && current.isSameOrigin(url)) return null;
            if (!request.isForMainFrame() && ServiceUrlPolicy.isSafeExternalHttps(url)) return null;
            if (!request.isForMainFrame() && ServiceUrlPolicy.isImageDataResource(url)) return null;
            // Blocks file/content/intent URLs and public HTTP fetches without a native bridge.
            return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked",
                    Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            ServiceUrlPolicy current = service;
            if (current == null || !current.isSameOrigin(url)) {
                view.stopLoading();
                showFailure(R.string.network_help);
            }
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (!editingAddress && !pageFailed && service != null && service.isSameOrigin(url)) {
                clearOverlay();
                view.setVisibility(View.VISIBLE);
            }
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) showFailure(R.string.network_help);
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
            if (request.isForMainFrame() && response.getStatusCode() >= 400) showFailure(R.string.network_help);
        }

        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            handler.cancel();
            showFailure(R.string.network_help);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != PICK_IMAGE) return;
        ValueCallback<Uri[]> callback = fileCallback;
        fileCallback = null;
        if (callback == null) return;
        Uri chosen = data == null ? null : data.getData();
        boolean multiple = data != null && data.getClipData() != null && data.getClipData().getItemCount() > 1;
        if (resultCode == RESULT_OK && !destroyed && !editingAddress && !multiple && chosen != null
                && "content".equalsIgnoreCase(chosen.getScheme())) {
            try {
                String mime = getContentResolver().getType(chosen);
                if (mime != null && mime.toLowerCase(java.util.Locale.ROOT).startsWith("image/")) {
                    callback.onReceiveValue(new Uri[]{chosen});
                    return;
                }
            } catch (RuntimeException ignored) {
                // Show an actionable message, never provider exception details.
            }
        }
        callback.onReceiveValue(null);
        if (resultCode == RESULT_OK) toast(R.string.image_unavailable);
    }

    private void cancelFileChoice() {
        ValueCallback<Uri[]> callback = fileCallback;
        fileCallback = null;
        if (callback != null) callback.onReceiveValue(null);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        destroyed = true;
        cancelFileChoice();
        if (Build.VERSION.SDK_INT >= 33 && backCallback != null) {
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
        }
        destroyWebView();
        super.onDestroy();
    }

    private void destroyWebView() {
        cancelFileChoice();
        if (webView == null) return;
        WebView previous = webView;
        webView = null;
        previous.stopLoading();
        content.removeView(previous);
        previous.setWebChromeClient(null);
        previous.setWebViewClient(new WebViewClient());
        previous.destroy();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        handleBack();
    }

    private void handleBack() {
        if (editingAddress && service != null) {
            loadService();
        } else if (!editingAddress && !pageFailed && webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            finish();
        }
    }

    private LinearLayout panel() {
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(24), dp(28), dp(24), dp(28));
        panel.setBackgroundColor(BACKGROUND);
        return panel;
    }

    private TextView text(int resource, int size) {
        TextView text = new TextView(this);
        text.setText(resource);
        text.setTextSize(size);
        text.setTextColor(INK);
        text.setLineSpacing(dp(3), 1);
        return text;
    }

    private Button button(int resource) {
        Button button = new Button(this);
        button.setText(resource);
        button.setTextSize(14);
        button.setTextColor(0xFF007AFF);
        button.setAllCaps(false);
        return button;
    }

    private void addSpace(LinearLayout parent, int height) {
        parent.addView(new View(this), new LinearLayout.LayoutParams(1, dp(height)));
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void toast(int resource) {
        if (!destroyed) Toast.makeText(this, resource, Toast.LENGTH_SHORT).show();
    }
}
