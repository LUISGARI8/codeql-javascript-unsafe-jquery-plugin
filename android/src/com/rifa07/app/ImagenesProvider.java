package com.rifa07.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/** Sirve, solo para lectura, las imágenes que la app comparte (carpeta cache/compartir). */
public class ImagenesProvider extends ContentProvider {
    @Override public boolean onCreate() { return true; }

    private File archivo(Uri uri) {
        String nombre = new File(uri.getPath()).getName(); // getName() impide salir de la carpeta
        return new File(new File(getContext().getCacheDir(), "compartir"), nombre);
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String modo) throws FileNotFoundException {
        File f = archivo(uri);
        if (!f.isFile()) throw new FileNotFoundException(uri.toString());
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override public String getType(Uri uri) { return "image/png"; }

    @Override
    public Cursor query(Uri uri, String[] p, String s, String[] a, String o) {
        File f = archivo(uri);
        MatrixCursor c = new MatrixCursor(new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE });
        c.addRow(new Object[] { f.getName(), f.length() });
        return c;
    }

    @Override public Uri insert(Uri uri, ContentValues v) { return null; }
    @Override public int delete(Uri uri, String s, String[] a) { return 0; }
    @Override public int update(Uri uri, ContentValues v, String s, String[] a) { return 0; }
}
