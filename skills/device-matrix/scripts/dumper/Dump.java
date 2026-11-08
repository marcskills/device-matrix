import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.UiAutomation;
import android.graphics.Rect;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import com.android.uiautomator.core.UiDevice;
import com.android.uiautomator.testrunner.UiAutomatorTestCase;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.List;

/**
 * `uiautomator dump` first waits for the app to go quiet, which an app with a looping animation never does
 * ("could not get idle state"). This writes the same kind of XML without waiting (the matrix has already
 * waited), from the app's own window only, so system windows (status bar, navigation bar) stay out.
 * Run: uiautomator runtest dumper.jar -c Dump -e out /data/local/tmp/ui.xml -e package com.example.app
 */
public class Dump extends UiAutomatorTestCase {
  public void testDump() throws Exception {
    String out = getParams().getString("out", "/data/local/tmp/ui.xml");
    String pkg = getParams().getString("package", "");
    UiAutomation automation = automation(getUiDevice());
    // Without this flag getWindows() is empty; with it, the app's window can be found beside the system's.
    AccessibilityServiceInfo info = automation.getServiceInfo();
    info.flags |= AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS | AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS;
    automation.setServiceInfo(info);
    AccessibilityNodeInfo root = null;
    for (int attempt = 0; attempt < 20 && root == null; attempt++) {
      List<AccessibilityWindowInfo> windows = automation.getWindows();
      for (AccessibilityWindowInfo window : windows) {
        AccessibilityNodeInfo candidate = window.getRoot();
        if (candidate != null && pkg.contentEquals(candidate.getPackageName() == null ? "" : candidate.getPackageName())) { root = candidate; break; }
      }
      if (root == null) root = pkg.isEmpty() ? automation.getRootInActiveWindow() : null;
      if (root == null) Thread.sleep(250);
    }
    if (root == null) throw new IllegalStateException("no window for " + pkg);
    try (Writer writer = new OutputStreamWriter(new FileOutputStream(out), "UTF-8")) {
      writer.write("<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation=\"0\">");
      write(writer, root, 0);
      writer.write("</hierarchy>");
    }
  }

  private static UiAutomation automation(UiDevice device) throws Exception {
    Method bridgeGetter = UiDevice.class.getDeclaredMethod("getAutomatorBridge");
    bridgeGetter.setAccessible(true);
    Object bridge = bridgeGetter.invoke(device);
    for (Class<?> type = bridge.getClass(); type != null; type = type.getSuperclass()) {
      for (Field field : type.getDeclaredFields()) {
        if (UiAutomation.class.isAssignableFrom(field.getType())) {
          field.setAccessible(true);
          return (UiAutomation) field.get(bridge);
        }
      }
    }
    throw new IllegalStateException("no UiAutomation in " + bridge.getClass());
  }

  private static void write(Writer writer, AccessibilityNodeInfo node, int index) throws Exception {
    Rect bounds = new Rect();
    node.getBoundsInScreen(bounds);
    writer.write("<node index=\"" + index + "\"");
    attribute(writer, "text", node.getText());
    attribute(writer, "resource-id", node.getViewIdResourceName());
    attribute(writer, "class", node.getClassName());
    attribute(writer, "package", node.getPackageName());
    attribute(writer, "content-desc", node.getContentDescription());
    attribute(writer, "clickable", String.valueOf(node.isClickable()));
    attribute(writer, "long-clickable", String.valueOf(node.isLongClickable()));
    attribute(writer, "enabled", String.valueOf(node.isEnabled()));
    attribute(writer, "focusable", String.valueOf(node.isFocusable()));
    attribute(writer, "scrollable", String.valueOf(node.isScrollable()));
    attribute(writer, "visible-to-user", String.valueOf(node.isVisibleToUser()));
    attribute(writer, "bounds", "[" + bounds.left + "," + bounds.top + "][" + bounds.right + "," + bounds.bottom + "]");
    writer.write(">");
    for (int i = 0; i < node.getChildCount(); i++) {
      AccessibilityNodeInfo child = node.getChild(i);
      if (child != null) write(writer, child, i);
    }
    writer.write("</node>");
  }

  private static void attribute(Writer writer, String name, CharSequence value) throws Exception {
    String text = value == null ? "" : value.toString();
    StringBuilder escaped = new StringBuilder();
    for (char c : text.toCharArray()) {
      switch (c) {
        case '&': escaped.append("&amp;"); break;
        case '<': escaped.append("&lt;"); break;
        case '>': escaped.append("&gt;"); break;
        case '"': escaped.append("&quot;"); break;
        case '\n': escaped.append("&#10;"); break;
        default: if (c >= 0x20 || c == '\t') escaped.append(c);
      }
    }
    writer.write(" " + name + "=\"" + escaped + "\"");
  }
}
