import 'package:flutter/material.dart';

/// The app's logo (the same image as the launcher icon).
class AppLogo extends StatelessWidget {
  const AppLogo({super.key, this.size = 40});

  static const asset = 'assets/images/app_logo.png';

  final double size;

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      asset,
      width: size,
      height: size,
      fit: BoxFit.contain,
      filterQuality: FilterQuality.medium,
      semanticLabel: 'Moment Field Executive Management logo',
    );
  }
}
