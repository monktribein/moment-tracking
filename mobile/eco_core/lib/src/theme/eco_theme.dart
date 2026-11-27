import 'package:flutter/material.dart';

/// Eco Sor colours (design: blue #1E40AF and orange #F97316).
class EcoColors {
  EcoColors._();

  static const blue = Color(0xFF1E40AF);
  static const blueBright = Color(0xFF2563EB);
  static const navy = Color(0xFF0B1F4D);
  static const orange = Color(0xFFF97316);
  static const orangeDark = Color(0xFFEA580C);
  static const green = Color(0xFF16A34A);
  static const red = Color(0xFFDC2626);
  static const amber = Color(0xFFD97706);
  static const violet = Color(0xFF7C3AED);
  static const teal = Color(0xFF0D9488);
  static const bg = Color(0xFFF3F6FB);
  static const text = Color(0xFF0F172A);
  static const muted = Color(0xFF64748B);
  static const border = Color(0xFFE3E9F5);
}

ThemeData ecoTheme() {
  final scheme = ColorScheme.fromSeed(seedColor: EcoColors.blue, primary: EcoColors.blue, secondary: EcoColors.orange, surface: Colors.white);
  final rounded = RoundedRectangleBorder(borderRadius: BorderRadius.circular(14));
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: EcoColors.bg,
    appBarTheme: const AppBarTheme(
      backgroundColor: EcoColors.blue,
      foregroundColor: Colors.white,
      elevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: Colors.white),
    ),
    cardTheme: CardThemeData(
      color: Colors.white,
      elevation: 0,
      margin: const EdgeInsets.symmetric(vertical: 6),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: const BorderSide(color: EcoColors.border)),
    ),
    // Primary actions are orange, like the design's "Check-out" / "Submit" buttons.
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: EcoColors.orange,
        foregroundColor: Colors.white,
        minimumSize: const Size.fromHeight(50),
        shape: rounded,
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(foregroundColor: EcoColors.blue, minimumSize: const Size.fromHeight(46), shape: rounded, side: const BorderSide(color: EcoColors.blue)),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: EcoColors.border)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: EcoColors.border)),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: EcoColors.blue, width: 1.6)),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: EcoColors.navy,
      indicatorColor: EcoColors.orange.withValues(alpha: 0.18),
      labelTextStyle: WidgetStateProperty.resolveWith((s) => TextStyle(fontSize: 12, color: s.contains(WidgetState.selected) ? EcoColors.orange : Colors.white70, fontWeight: FontWeight.w600)),
      iconTheme: WidgetStateProperty.resolveWith((s) => IconThemeData(color: s.contains(WidgetState.selected) ? EcoColors.orange : Colors.white70)),
    ),
    chipTheme: ChipThemeData(shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20))),
  );
}
