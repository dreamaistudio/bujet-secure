package com.thisara.budgetsecure;

import android.content.pm.ApplicationInfo;
import android.os.Bundle;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppUpdatePlugin.class);
        super.onCreate(savedInstanceState);
        
        // Edge-to-edge disabled as requested
        WindowCompat.setDecorFitsSystemWindows(getWindow(), true);

        // Keep system status bar and nav bar matching app's dark background
        getWindow().setStatusBarColor(0xFF09090B);
        getWindow().setNavigationBarColor(0xFF09090B);

        // Enable remote Chrome WebView debugging ONLY in debug builds (disabled in release builds)
        if (0 != (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE)) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
    }
}
