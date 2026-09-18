package ua.cimeika.cipoint;

import android.graphics.Canvas;
import android.graphics.ColorFilter;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.drawable.Drawable;

final class CiHexagonDrawable extends Drawable {
    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint stroke = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path path = new Path();

    CiHexagonDrawable(int fillColor, int strokeColor, float strokeWidth) {
        fill.setStyle(Paint.Style.FILL);
        fill.setColor(fillColor);
        stroke.setStyle(Paint.Style.STROKE);
        stroke.setColor(strokeColor);
        stroke.setStrokeWidth(strokeWidth);
    }

    @Override protected void onBoundsChange(Rect bounds) {
        super.onBoundsChange(bounds);
        float l = bounds.left;
        float t = bounds.top;
        float r = bounds.right;
        float b = bounds.bottom;
        float w = r - l;
        float h = b - t;
        float inset = Math.min(w * 0.18f, h * 0.55f);
        path.reset();
        path.moveTo(l + inset, t);
        path.lineTo(r - inset, t);
        path.lineTo(r, t + h / 2f);
        path.lineTo(r - inset, b);
        path.lineTo(l + inset, b);
        path.lineTo(l, t + h / 2f);
        path.close();
    }

    @Override public void draw(Canvas canvas) {
        canvas.drawPath(path, fill);
        canvas.drawPath(path, stroke);
    }

    @Override public void setAlpha(int alpha) {
        fill.setAlpha(alpha);
        invalidateSelf();
    }

    @Override public void setColorFilter(ColorFilter colorFilter) {
        fill.setColorFilter(colorFilter);
        stroke.setColorFilter(colorFilter);
        invalidateSelf();
    }

    @Override public int getOpacity() {
        return PixelFormat.TRANSLUCENT;
    }
}
