package org.osmlocal.plans;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.activity.ComponentDialog;
import androidx.activity.OnBackPressedCallback;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayInputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;

/**
 * Navigateur intégré de la recherche sur le web (`app/src/services/webSearch.ts`).
 *
 * Une fenêtre plein écran : la page, et un bandeau en bas qui montre le lieu
 * retrouvé avec « Voir sur la carte ». Toute la décision se prend côté web — ce
 * greffon affiche, transmet, et **protège** :
 *
 * - pas de position pour les pages (géolocalisation refusée), ni caméra ni micro ;
 * - pas de cookies tiers, et cookies comme stockage des sites effacés à la fermeture ;
 * - aucune requête vers Google, page ou ressource (`blockedHosts`, fourni par la page) ;
 * - les liens de cartes (`linkPatterns`) ne sont jamais ouverts : leur adresse est
 *   passée à la page, qui en lit la position ;
 * - aucun autre schéma que http(s) : ni `intent:`, ni ouverture d'une autre application.
 *
 * Statistiques et Safe Browsing de la WebView sont coupés pour toute
 * l'application par le manifeste ; Safe Browsing l'est aussi ici, explicitement.
 */
@CapacitorPlugin(name = "WebSearch")
public class WebSearchPlugin extends Plugin {

    private static final int MATCH = ViewGroup.LayoutParams.MATCH_PARENT;
    private static final int WRAP = ViewGroup.LayoutParams.WRAP_CONTENT;

    private ComponentDialog dialog;
    private WebView web;
    private TextView hostText;
    private TextView barTitle;
    private TextView barSubtitle;
    private TextView goButton;
    private ProgressBar progress;
    private LinearLayout bar;
    private View barLine;
    private TextView barPin;

    private final List<Pattern> linkPatterns = new ArrayList<>();
    private Pattern blockedHosts;
    private String pageScript = "";
    private boolean dark;
    private int ink;
    private int muted;
    private int raised;
    private int accent;
    /** Vrai tant que le bandeau montre un lieu : l'animation ne joue qu'à l'apparition. */
    private boolean barFound;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable inspect = () -> {
        if (web != null && !pageScript.isEmpty()) web.evaluateJavascript(pageScript, null);
    };

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !url.startsWith("https://")) {
            call.reject("Adresse refusée.");
            return;
        }
        List<Pattern> patterns = new ArrayList<>();
        Pattern blocked;
        try {
            JSArray list = call.getArray("linkPatterns");
            if (list != null) {
                for (int i = 0; i < list.length(); i++) {
                    String pattern = list.optString(i, null);
                    if (pattern != null) patterns.add(Pattern.compile(pattern, Pattern.CASE_INSENSITIVE));
                }
            }
            String hosts = call.getString("blockedHosts");
            blocked = hosts != null ? Pattern.compile(hosts, Pattern.CASE_INSENSITIVE) : null;
        } catch (PatternSyntaxException e) {
            call.reject("Motif invalide : " + e.getMessage());
            return;
        }
        boolean isDark = Boolean.TRUE.equals(call.getBoolean("dark", false));
        String script = call.getString("script", "");
        JSObject labels = call.getObject("labels", new JSObject());

        getActivity().runOnUiThread(() -> {
            dismiss();
            linkPatterns.clear();
            linkPatterns.addAll(patterns);
            blockedHosts = blocked;
            pageScript = script == null ? "" : script;
            dark = isDark;
            build(labels);
            web.loadUrl(url);
            call.resolve();
        });
    }

    @PluginMethod
    public void setCandidate(PluginCall call) {
        String state = call.getString("state", "hint");
        String title = call.getString("title", "");
        String subtitle = call.getString("subtitle", "");
        String action = call.getString("action", "");
        getActivity().runOnUiThread(() -> {
            if (dialog != null) showBar(state, title, subtitle, action);
            call.resolve();
        });
    }

    @PluginMethod
    public void close(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            dismiss();
            call.resolve();
        });
    }

    // --- La fenêtre -----------------------------------------------------------

    private void build(JSObject labels) {
        Activity activity = getActivity();
        int surface = dark ? 0xFF1C1C1E : 0xFFFFFFFF;
        raised = dark ? 0xFF2C2C2E : 0xFFF2F2F7;
        accent = dark ? 0xFF0A84FF : 0xFF007AFF;
        int hairline = dark ? 0x47787880 : 0x1F3C3C43;
        ink = dark ? 0xFFF2F2F7 : 0xFF1C1C1E;
        muted = dark ? 0xFF98989F : 0xFF8E8E93;

        LinearLayout root = new LinearLayout(activity);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(surface);

        LinearLayout top = new LinearLayout(activity);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);
        TextView back = iconButton("‹", labels.getString("back", ""), 30);
        back.setOnClickListener(v -> {
            if (web != null && web.canGoBack()) web.goBack();
        });
        hostText = new TextView(activity);
        hostText.setTextColor(muted);
        hostText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        hostText.setSingleLine(true);
        hostText.setEllipsize(TextUtils.TruncateAt.END);
        hostText.setGravity(Gravity.CENTER);
        TextView closeButton = iconButton("✕", labels.getString("close", ""), 20);
        closeButton.setOnClickListener(v -> dismiss());
        top.addView(back, new LinearLayout.LayoutParams(dp(52), dp(52)));
        top.addView(hostText, new LinearLayout.LayoutParams(0, WRAP, 1f));
        top.addView(closeButton, new LinearLayout.LayoutParams(dp(52), dp(52)));
        root.addView(top, new LinearLayout.LayoutParams(MATCH, WRAP));

        progress = new ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        progress.setProgressTintList(ColorStateList.valueOf(accent));
        root.addView(progress, new LinearLayout.LayoutParams(MATCH, dp(3)));

        web = new WebView(activity);
        configure(web);
        root.addView(web, new LinearLayout.LayoutParams(MATCH, 0, 1f));

        barLine = new View(activity);
        barLine.setBackgroundColor(hairline);
        root.addView(barLine, new LinearLayout.LayoutParams(MATCH, 1));

        bar = new LinearLayout(activity);
        bar.setBackgroundColor(raised);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setMinimumHeight(dp(64));
        bar.setPadding(dp(16), dp(10), dp(12), dp(10));
        LinearLayout texts = new LinearLayout(activity);
        texts.setOrientation(LinearLayout.VERTICAL);
        barTitle = new TextView(activity);
        barTitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        barTitle.setMaxLines(2);
        barTitle.setEllipsize(TextUtils.TruncateAt.END);
        barSubtitle = new TextView(activity);
        barSubtitle.setTextColor(muted);
        barSubtitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        barSubtitle.setMaxLines(2);
        barSubtitle.setEllipsize(TextUtils.TruncateAt.END);
        texts.addView(barTitle);
        texts.addView(barSubtitle);
        goButton = new TextView(activity);
        goButton.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        goButton.setTypeface(Typeface.DEFAULT_BOLD);
        goButton.setGravity(Gravity.CENTER);
        goButton.setMinHeight(dp(44));
        goButton.setPadding(dp(16), dp(8), dp(16), dp(8));
        goButton.setVisibility(View.GONE);
        goButton.setOnClickListener(v -> notifyListeners("go", new JSObject()));
        barPin = new TextView(activity);
        barPin.setText("📍");
        barPin.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22);
        barPin.setVisibility(View.GONE);
        LinearLayout.LayoutParams pinParams = new LinearLayout.LayoutParams(WRAP, WRAP);
        pinParams.rightMargin = dp(10);
        bar.addView(barPin, pinParams);
        bar.addView(texts, new LinearLayout.LayoutParams(0, WRAP, 1f));
        LinearLayout.LayoutParams goParams = new LinearLayout.LayoutParams(WRAP, WRAP);
        goParams.leftMargin = dp(10);
        bar.addView(goButton, goParams);
        root.addView(bar, new LinearLayout.LayoutParams(MATCH, WRAP));

        // Bord à bord : la fenêtre se tient elle-même à l'écart des barres
        // système, de l'encoche et du clavier.
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime()
            );
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });

        dialog = new ComponentDialog(
            activity,
            dark ? android.R.style.Theme_Material_NoActionBar : android.R.style.Theme_Material_Light_NoActionBar
        );
        dialog.setContentView(root);
        Window window = dialog.getWindow();
        if (window != null) {
            window.setLayout(MATCH, MATCH);
            window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
            WindowCompat.setDecorFitsSystemWindows(window, false);
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, root);
            controller.setAppearanceLightStatusBars(!dark);
            controller.setAppearanceLightNavigationBars(!dark);
        }
        // Le geste retour remonte l'historique de la page, puis ferme.
        dialog.getOnBackPressedDispatcher().addCallback(dialog, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (web != null && web.canGoBack()) web.goBack();
                else dismiss();
            }
        });
        dialog.setOnDismissListener(d -> cleanUp());
        showBar("hint", labels.getString("hint", ""), "", "");
        dialog.show();
    }

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    private void configure(WebView view) {
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setGeolocationEnabled(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) settings.setSafeBrowsingEnabled(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, false);

        view.addJavascriptInterface(new PageBridge(), "MyOsmWeb");
        view.setDownloadListener((url, userAgent, disposition, mimeType, length) -> {
            // Aucun téléchargement.
        });
        view.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView v, int value) {
                if (progress == null) return;
                progress.setProgress(value);
                progress.setVisibility(value >= 100 ? View.INVISIBLE : View.VISIBLE);
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                callback.invoke(origin, false, false);
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.deny();
            }
        });
        view.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                return intercept(request.getUrl());
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest request) {
                if (!isBlocked(request.getUrl())) return null;
                if (request.isForMainFrame()) notifyListeners("blocked", new JSObject());
                return new WebResourceResponse("text/plain", "utf-8", 403, "Blocked", new HashMap<>(), new ByteArrayInputStream(new byte[0]));
            }

            @Override
            public void onPageStarted(WebView v, String url, Bitmap favicon) {
                handler.removeCallbacks(inspect);
                if (hostText != null) hostText.setText(hostOf(url));
                JSObject data = new JSObject();
                data.put("url", url);
                notifyListeners("navigate", data);
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                // Maintenant, puis deux fois ensuite : beaucoup de pages — les
                // résultats de DuckDuckGo compris — se construisent en JavaScript.
                handler.removeCallbacks(inspect);
                inspect.run();
                handler.postDelayed(inspect, 1500);
                handler.postDelayed(inspect, 4000);
            }
        });
    }

    /** Vrai si la navigation est retenue ici plutôt que chargée. */
    private boolean intercept(Uri uri) {
        String url = uri.toString();
        for (Pattern pattern : linkPatterns) {
            if (pattern.matcher(url).find()) {
                JSObject data = new JSObject();
                data.put("url", url);
                notifyListeners("link", data);
                return true;
            }
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
        if (!scheme.equals("http") && !scheme.equals("https")) return true;
        if (isBlocked(uri)) {
            notifyListeners("blocked", new JSObject());
            return true;
        }
        return false;
    }

    private boolean isBlocked(Uri uri) {
        String host = uri.getHost();
        return host != null && blockedHosts != null && blockedHosts.matcher(host.toLowerCase()).find();
    }

    private void showBar(String state, String title, String subtitle, String action) {
        if (barTitle == null || bar == null) return;
        boolean found = "found".equals(state);
        // Un lieu retrouvé doit se voir du premier coup d'œil (demande explicite :
        // noir sur noir, le bandeau ne se repérait pas) : couleur d'accent, texte
        // blanc, bouton blanc, et une courte montée à l'apparition. Le reste du
        // temps, un gris à peine relevé le distingue de la page sans attirer l'œil.
        bar.setBackgroundColor(found ? accent : raised);
        barLine.setVisibility(found ? View.GONE : View.VISIBLE);
        barPin.setVisibility(found ? View.VISIBLE : View.GONE);
        barTitle.setText(title);
        barTitle.setTextColor(found ? Color.WHITE : "hint".equals(state) ? muted : ink);
        barTitle.setTypeface(found ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
        barSubtitle.setText(subtitle);
        barSubtitle.setTextColor(found ? 0xDDFFFFFF : muted);
        barSubtitle.setVisibility(subtitle == null || subtitle.isEmpty() ? View.GONE : View.VISIBLE);
        GradientDrawable pill = new GradientDrawable();
        pill.setColor(Color.WHITE);
        pill.setCornerRadius(dp(22));
        goButton.setBackground(pill);
        goButton.setTextColor(accent);
        goButton.setText(action);
        goButton.setVisibility(found && action != null && !action.isEmpty() ? View.VISIBLE : View.GONE);
        if (found && !barFound) {
            bar.setTranslationY(dp(28));
            bar.animate().translationY(0).setDuration(220).start();
        }
        barFound = found;
    }

    private void dismiss() {
        if (dialog != null && dialog.isShowing()) dialog.dismiss();
        else cleanUp();
    }

    /** Ferme sans rien laisser derrière : page, historique, cookies, stockage des sites. */
    private void cleanUp() {
        handler.removeCallbacks(inspect);
        if (web != null) {
            web.stopLoading();
            web.removeJavascriptInterface("MyOsmWeb");
            web.clearHistory();
            ViewGroup parent = (ViewGroup) web.getParent();
            if (parent != null) parent.removeView(web);
            web.destroy();
            web = null;
        }
        // L'application elle-même n'utilise pas de cookies ; son stockage local
        // (origine `https://localhost`) est épargné.
        CookieManager.getInstance().removeAllCookies(null);
        WebStorage storage = WebStorage.getInstance();
        storage.getOrigins(origins -> {
            if (origins == null) return;
            for (Object origin : ((Map<?, ?>) origins).keySet()) {
                String name = String.valueOf(origin);
                if (!name.contains("://localhost")) storage.deleteOrigin(name);
            }
        });
        barTitle = null;
        barSubtitle = null;
        bar = null;
        barLine = null;
        barPin = null;
        barFound = false;
        goButton = null;
        hostText = null;
        progress = null;
        boolean wasOpen = dialog != null;
        dialog = null;
        if (wasOpen) notifyListeners("closed", new JSObject());
    }

    // --- Outils ---------------------------------------------------------------

    private TextView iconButton(String glyph, String description, int sizeSp) {
        TextView button = new TextView(getActivity());
        button.setText(glyph);
        button.setContentDescription(description);
        button.setTextColor(ink);
        button.setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp);
        button.setGravity(Gravity.CENTER);
        TypedValue ripple = new TypedValue();
        if (getActivity().getTheme().resolveAttribute(android.R.attr.selectableItemBackgroundBorderless, ripple, true)) {
            button.setBackgroundResource(ripple.resourceId);
        }
        return button;
    }

    private int dp(int value) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, getContext().getResources().getDisplayMetrics()));
    }

    private static String hostOf(String url) {
        String host = url == null ? null : Uri.parse(url).getHost();
        if (host == null) return "";
        return host.startsWith("www.") ? host.substring(4) : host;
    }

    /** Ce que la page peut appeler : transmettre, rien d'autre. */
    private class PageBridge {
        @JavascriptInterface
        public void page(String json) {
            if (json == null || json.length() > 200_000) return;
            JSObject data = new JSObject();
            data.put("json", json);
            notifyListeners("page", data);
        }

        @JavascriptInterface
        public void selection(String text) {
            if (text == null) return;
            JSObject data = new JSObject();
            data.put("text", text.length() > 400 ? text.substring(0, 400) : text);
            notifyListeners("selection", data);
        }
    }
}
