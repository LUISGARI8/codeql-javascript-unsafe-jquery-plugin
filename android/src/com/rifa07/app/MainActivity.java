package com.rifa07.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * Rifa 07: el talonario funciona dentro de la app, sin internet.
 * Los datos quedan guardados en este celular (almacenamiento local del WebView).
 */
public class MainActivity extends Activity {
    private WebView web;
    private ValueCallback<Uri[]> eligiendoFoto;
    private static final int ELEGIR_FOTO = 7;

    @Override
    protected void onCreate(Bundle estado) {
        super.onCreate(estado);
        getWindow().setStatusBarColor(Color.parseColor("#1F3B2F"));

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setTextZoom(100);

        web.setWebChromeClient(new WebChromeClient() {
            /** Abre la galería del celular cuando la página pide la foto del premio. */
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (eligiendoFoto != null) eligiendoFoto.onReceiveValue(null);
                eligiendoFoto = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("image/*");
                try {
                    startActivityForResult(Intent.createChooser(i, "Foto del premio"), ELEGIR_FOTO);
                } catch (Exception e) {
                    eligiendoFoto = null;
                    aviso("No se encontró una galería para elegir la foto");
                    return false;
                }
                return true;
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, String url) {
                return abrirFuera(url);
            }
        });
        web.addJavascriptInterface(new Puente(), "Rifa07Android");
        setContentView(web);

        if (estado != null) web.restoreState(estado);
        else web.loadUrl("file:///android_asset/index.html");
    }

    /** Los enlaces de WhatsApp (wa.me) y cualquier página web se abren fuera de la app. */
    private boolean abrirFuera(String url) {
        if (url.startsWith("file:")) return false;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Exception e) {
            aviso("No se encontró una app para abrir el enlace");
        }
        return true;
    }

    @Override
    protected void onActivityResult(int pedido, int resultado, Intent datos) {
        if (pedido == ELEGIR_FOTO && eligiendoFoto != null) {
            eligiendoFoto.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultado, datos));
            eligiendoFoto = null;
            return;
        }
        super.onActivityResult(pedido, resultado, datos);
    }

    @Override
    protected void onSaveInstanceState(Bundle salida) {
        super.onSaveInstanceState(salida);
        web.saveState(salida);
    }

    /** El botón «atrás» cierra ventanas y vuelve a Inicio antes de salir de la app. */
    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    private void aviso(final String texto) {
        runOnUiThread(new Runnable() {
            public void run() { Toast.makeText(MainActivity.this, texto, Toast.LENGTH_SHORT).show(); }
        });
    }

    private static String nombreSeguro(String nombre) {
        String n = nombre == null ? "" : nombre.replaceAll("[^A-Za-z0-9._-]", "_");
        if (!n.endsWith(".png")) n = n + ".png";
        return n.length() > 80 ? n.substring(n.length() - 80) : n;
    }

    /** Funciones del celular que usa la página: compartir, guardar y copiar. */
    private class Puente {
        @JavascriptInterface
        public void copy(final String texto) {
            runOnUiThread(new Runnable() {
                public void run() {
                    ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                    cm.setPrimaryClip(ClipData.newPlainText("Rifa 07", texto));
                }
            });
        }

        @JavascriptInterface
        public void shareImage(String base64, String nombre, final String texto) {
            try {
                File dir = new File(getCacheDir(), "compartir");
                dir.mkdirs();
                File f = new File(dir, nombreSeguro(nombre));
                FileOutputStream out = new FileOutputStream(f);
                out.write(Base64.decode(base64, Base64.DEFAULT));
                out.close();
                final Uri uri = Uri.parse("content://com.rifa07.app.imagenes/" + f.getName());
                runOnUiThread(new Runnable() {
                    public void run() {
                        Intent i = new Intent(Intent.ACTION_SEND);
                        i.setType("image/png");
                        i.putExtra(Intent.EXTRA_STREAM, uri);
                        if (texto != null && texto.length() > 0) i.putExtra(Intent.EXTRA_TEXT, texto);
                        i.setClipData(ClipData.newRawUri("", uri));
                        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        startActivity(Intent.createChooser(i, "Enviar imagen"));
                    }
                });
            } catch (Exception e) {
                aviso("No se pudo preparar la imagen");
            }
        }

        @JavascriptInterface
        public String saveImage(String base64, String nombre) {
            if (Build.VERSION.SDK_INT < 29) {
                shareImage(base64, nombre, "");
                return "Escoge dónde guardar la imagen";
            }
            try {
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, nombreSeguro(nombre));
                v.put(MediaStore.MediaColumns.MIME_TYPE, "image/png");
                v.put("relative_path", "Pictures/Rifa 07");
                Uri uri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
                OutputStream out = getContentResolver().openOutputStream(uri);
                out.write(Base64.decode(base64, Base64.DEFAULT));
                out.close();
                return "Imagen guardada en la Galería, carpeta Rifa 07";
            } catch (Exception e) {
                return "No se pudo guardar la imagen";
            }
        }
    }
}
