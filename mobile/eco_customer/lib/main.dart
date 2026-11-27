import 'package:eco_core/eco_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'router.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initializeDateFormatting('en_IN');
  // Push works only once the Firebase files are added (see mobile/README.md).
  await PushSetup.init();
  runApp(ProviderScope(
    overrides: [
      authConfigProvider.overrideWithValue(const AuthConfig(
        allowedRoles: {'customer'},
        wrongAppMessage: 'This app is for Eco Sor customers. Staff use the Eco Sor Employee app.',
        tokenKey: 'eco_customer_token',
      )),
    ],
    child: const EcoCustomerApp(),
  ));
}

class EcoCustomerApp extends ConsumerWidget {
  const EcoCustomerApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp.router(
      title: 'Eco Sor',
      debugShowCheckedModeBanner: false,
      theme: ecoTheme(),
      routerConfig: ref.watch(routerProvider),
    );
  }
}
