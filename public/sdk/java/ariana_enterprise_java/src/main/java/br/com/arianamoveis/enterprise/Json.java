package br.com.arianamoveis.enterprise;
import java.util.*;
import java.util.stream.Collectors;

final class Json {
  private Json() {}
  static String of(Object value) {
    if (value == null) return "null";
    if (value instanceof String s) return "\"" + escape(s) + "\"";
    if (value instanceof Number || value instanceof Boolean) return String.valueOf(value);
    if (value instanceof Map<?,?> map) {
      return "{" + map.entrySet().stream()
        .map(e -> of(String.valueOf(e.getKey())) + ":" + of(e.getValue()))
        .collect(Collectors.joining(",")) + "}";
    }
    if (value instanceof Iterable<?> it) {
      List<String> items = new ArrayList<>();
      for (Object item : it) items.add(of(item));
      return "[" + String.join(",", items) + "]";
    }
    return of(String.valueOf(value));
  }
  private static String escape(String s) {
    return s.replace("\\", "\\\\").replace("\"", "\\\"");
  }
}
